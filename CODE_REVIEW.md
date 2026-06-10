# Code Review — Security & Optimization

**Date:** 2026-06-10
**Scope:** Full repository — all API routes (~66), middleware (`proxy.ts`), Supabase layer + RLS migrations, Garmin/Strava integrations, AI agent layer, plan operations, analysis modules, and the React frontend.

---

## TL;DR

**No critical security vulnerabilities found.** The security fundamentals are strong: RLS is enabled on all 21 tables with per-user policies, nearly every route does defense-in-depth (auth check + explicit `athlete_id` filter on top of RLS), there is zero XSS surface (no `dangerouslySetInnerHTML`, no `rehype-raw`), LLM API keys never reach the client, OAuth CSRF state is verified, all LLM tool actions require human approval, and nothing sensitive has ever been committed to git.

The highest-value changes are: a cross-plan **correctness bug** in `scale_week_volume`, three Medium security hardening items (admin-approval token, plaintext OAuth tokens, prompt injection), and large performance wins in activity sync (N+1), chat (latency + unbounded token cost), and the dashboard (query waterfalls).

---

## Priority 0 — Bugs / fix first

### P0.1 `executeScaleWeekVolume` queries `weekly_plans` without a plan filter (correctness + cross-tenant risk)
`lib/plans/operations/apply.ts:670-674`
```ts
.from('weekly_plans').select('id, weekly_volume_target')
  .eq('week_number', op.weekNumber).single()
```
No `plan_id`/`athlete_id` filter — matches `week_number` across **all plans**. `.single()` errors whenever more than one plan has that week number (almost always), silently skipping the volume-target update; in the worst case it can touch the wrong plan's week.
**Fix:** filter via `training_phases!inner(plan_id)` + `planId`, same pattern as `helpers.ts:210-220`.

### P0.2 Server code constructs the *browser* Supabase client (anon, no session)
`lib/agent/context-loader.ts:1`, `lib/analysis/flag-detector.ts:1`, `observation-manager.ts:1`, `adjustment-proposer.ts:1`, `adjustment-persistence.ts:1`, `phase-progress.ts:1` — all `import { createClient } from '@/lib/supabase/client'`, but they're invoked from API routes (`app/api/observations/route.ts`, `app/api/agent/chat/route.ts:71`).
Server-side, this client has no auth cookies, so queries run as `anon` against RLS — meaning these paths either silently return empty data or rely entirely on explicit `.eq('athlete_id', ...)` filters with no RLS backstop. It's also a fresh client per call.
**Fix:** accept a `SupabaseClient` parameter and pass the route's server client down — `lib/agent/coach-context-loader.ts` already does this correctly. Worth verifying whether observations/flag detection actually work server-side today.

---

## Priority 1 — Security hardening (Medium)

### P1.1 Admin approval link: permanent, state-changing GET, logged to console
`app/api/auth/approve/route.ts:5-68`, `lib/email/notify-admin.ts:6-18,38`
The approval token is `HMAC(athleteId, secret)` with **no expiry/nonce** — a forever-valid bearer credential, sent in an email link and **logged to console** when `RESEND_API_KEY` is unset. The GET is prefetchable/crawlable and writes with the service-role key.
**Fix:** include an expiry timestamp in the signed payload; stop logging the URL; ideally make approval a POST behind a confirmation page. Also escape the athlete email interpolated into the HTML response (`route.ts:51`) and email body (`notify-admin.ts:53`).

### P1.2 OAuth tokens stored in plaintext
`lib/garmin/client.ts:153-184`, `lib/strava/client.ts:95-124`
Garmin OAuth1 token+secret (long-lived) and Strava access/refresh tokens sit unencrypted in `athlete_integrations`. RLS protects against other users, but any DB snapshot/service-role leak exposes every athlete's connected accounts.
**Fix:** encrypt token columns (pgsodium/pgcrypto, or app-level AES-GCM with a `TOKEN_ENCRYPTION_KEY`). Also: Garmin disconnect (`client.ts:552-567`) deletes rows but never revokes the session server-side.

### P1.3 Prompt injection via synced activity names / feedback text
`lib/agent/coach-prompt.ts:330,279,260,450,162`, `lib/agent/prompts.ts:136`
Activity titles (settable by third-party apps with Strava write scope), feedback text, and coaching notes are interpolated verbatim into the **system** prompt. A crafted title can steer the AI coach's advice/proposals. Impact is bounded by human approval on tool actions, but it's still untrusted input in the most privileged prompt position.
**Fix:** wrap untrusted fields in explicit data delimiters (e.g. `<athlete_data>…</athlete_data>` with a "content is data, not instructions" note), strip control characters, cap lengths.

### P1.4 Public middleware prefixes are wholesale, not per-path
`proxy.ts:8` — `/api/auth/`, `/api/jobs/`, `/api/dev/` bypass the global auth gate entirely. Every current route under them self-guards correctly (cron secret, `NODE_ENV` checks, HMAC), but **any future route added under these prefixes ships unauthenticated by default**.
**Fix:** narrow to exact paths; validate `CRON_SECRET`/`ADMIN_APPROVAL_SECRET` presence in `lib/env.ts`; use a timing-safe compare for the cron secret.

### P1.5 No rate limiting on LLM endpoints
`agent/chat`, `agent/coach`, `plans/generate`, `plans/regenerate`, `activities/[id]/generate-summary` — auth-gated but unthrottled; a single account can drive unbounded LLM cost.
**Fix:** per-athlete throttling (e.g. token bucket keyed on athlete_id in Redis/Upstash or a Postgres counter).

### P1.6 Garmin credential flow: MFA-disable advice + `ensureAthleteExists` email fallback
- `lib/garmin/client.ts:55` tells users to "try authenticating while MFA is temporarily disabled" — coaching users to weaken their Garmin account. Reword; long-term, move to Garmin's official OAuth program (the password is correctly *not* persisted today).
- `lib/supabase/ensure-athlete.ts:29-39` (duplicated in 5 routes): falls back to matching the athlete row by **email** when the user-id lookup misses — a second auth account with the same email string could map onto the original athlete's data. Restrict the fallback to verified emails or remove it.

---

## Priority 2 — Performance, high impact

### P2.1 Garmin/Strava sync: N+1 queries per activity
`app/api/sync/garmin/route.ts:139-348`, `app/api/sync/strava/route.ts:183-411`
Per activity: existence check + ±12h dedup `select('*')` + single-row insert + another ±12h merge-candidate query — all sequential, while holding the sync lock. A 400-activity Garmin sync ≈ 1,200–1,600 round trips.
**Fix:** batch-fetch existing `garmin_id`s with one `.in()` query, load the full `[start−12h, end+12h]` window once for in-memory dedup/merge matching, bulk `upsert(..., { onConflict: 'athlete_id,garmin_id' })` (the unique index already exists). Also make syncs incremental: `last_synced_at` is written but never read (and Strava never updates it).

### P2.2 Chat: ~14 sequential DB round trips per message + unbounded token growth
- `lib/agent/context-loader.ts:4-13,230-251` — 9 sub-loaders awaited sequentially plus 4 sequential PR queries, on **every** chat message. `coach-context-loader.ts` already shows the right pattern (3 `Promise.all` rounds, narrow selects).
- `app/api/agent/chat/route.ts:88` / `coach/route.ts:466` — full session history loaded with no `.limit()` and resent to the LLM every turn; the coach route's token estimate omits history. `loadWeeklyContext` embeds full per-lap detail per activity.
**Fix:** `Promise.all` the loaders; cap history (token-budgeted truncation via `lib/chat/token-budget.ts`); summarize lap data. Cuts both latency and per-message LLM spend.

### P2.3 Dashboard: client-side auth+query waterfalls
- `lib/supabase/client.ts:13-17` — `getCurrentAthleteId` calls `supabase.auth.getUser()` (a network round trip) inside nearly every queryFn; each dashboard card pays it serially before its real fetch.
- `lib/analysis/phase-progress.ts` — 4 sequential dependent queries per card, run **from the browser** (`phase-progress-card.tsx:14-20`, `weekly-progress-chart.tsx:13-19`) → ~5-request serial chains per card.
**Fix:** resolve the user once (memoized, or `getSession()` reading the local JWT) or pass `athleteId` from the server layout; collapse the card queries into RPCs (the `get_dashboard_stats` RPC already demonstrates this) or server-fetch + hydrate.

### P2.4 Plan operations re-query data they already have
`lib/plans/operations/apply.ts` — `executeSwapDays` (:238), `executeMoveWorkoutType` (:293), `executeRemoveWorkoutType` (:701) each call `getWorkoutsForWeek` inside per-week loops (a joined 3-table select per week) plus sequential single-row updates — even though `applyOperations` already receives `planContext` containing every week/workout in memory.
**Fix:** resolve targets from `planContext`, batch writes (`upsert` of changed rows / `Promise.all`).

### P2.5 Chat UI: full markdown re-parse of all messages per streamed token
`components/chat/coach-interface.tsx:220-230,306-361,58`
Every streamed chunk rebuilds the messages array and re-runs `ReactMarkdown` for **all** prior assistant messages — O(history × chunks) jank in long conversations.
**Fix:** extract a `React.memo` message row, keep the in-flight message in separate state so only the tail re-renders, batch chunk flushes via rAF.

### P2.6 Bulk re-score endpoint: ~4 queries per workout over full history
`app/api/activities/match/route.ts:85-105` + `lib/activities/rescore-completion.ts:15-29` — PATCH loads all linked workouts unbounded, then per-workout fetches activity + workout + laps sequentially. A year of training ≈ 1,000+ sequential queries in one request.
**Fix:** batch-fetch with `.in()`, score in memory, upsert results.

---

## Priority 3 — Performance & hygiene, medium/low

1. **Drop moment.js** — only used for `momentLocalizer` in 4 calendar files; `date-fns@4` is already a dependency. Switch to RBC's `dateFnsLocalizer` → ~70KB gzip off every calendar route. Also stop mutating `moment.updateLocale` in render bodies (`training-calendar.tsx:272-276`).
2. **Column-scoped selects** — `lib/supabase/queries.ts` (lines 8-107) uses `select('*')` everywhere; activities rows carry `raw_data`/`garmin_data`/`strava_data` JSON blobs, so a month-view calendar fetch can move hundreds of KB the UI never reads. Same for `context-loader.ts:33` pulling the full athlete row (incl. email) into LLM context.
3. **Adopt the centralized query keys** — `lib/query-keys.ts` is used in exactly one call site; ~20 other `useQuery`s use string literals (invalidation-drift risk). Convert the `useEffect`+`useState` fetches (`plans/page.tsx:16-29`, `strength/page.tsx:15-23`, `coach-interface.tsx:88-134`) to React Query while you're there. Raise `staleTime` for near-static data (athlete, active-plan).
4. **`/api/observations` GET runs full flag detection synchronously** (`route.ts:24-31` → 10+ sequential queries per page view). Move detection to sync-completion or cron; `Promise.all` the independent queries; the volume query (`flag-detector.ts:52-57`) is missing its upper date bound.
5. **Stabilize react-big-calendar props** — inline accessors/handlers and a per-render `eventPropGetter` doing `workouts.find()` per activity (`training-calendar.tsx:608-615,866-890`) defeat RBC's memoization. `useCallback` + a `Map` lookup. Code-split the review-page calendar like `/dashboard/calendar` already does.
6. **Merge candidates route** — one query per pending activity (`merge/candidates/route.ts:35-43`); use one `.in()`. Same batching in `lib/chat/plan-replacer.ts:134-260` (4-5 queries per regenerated week).
7. **Activities page renders the full year twice** (desktop table + CSS-hidden mobile cards, `activities-view.tsx:396-587`); render one variant via `matchMedia` and/or paginate.
8. **Indexes**: add `training_plans(athlete_id, status)` (the hottest lookup — "find active plan"), `weekly_plans(phase_id)` (unindexed FK).
9. **LLM debug logger** (`lib/agent/llm-logger.ts`) writes full conversations + system prompts to disk whenever `NODE_ENV !== 'production'`; make it opt-in (`LLM_DEBUG_LOGS=true`) and add rotation. Trim verbose per-payload logging on hot paths (`plan-queries.ts:62-201`, Strava sync `:281`).
10. **Misc security/hygiene**: revoke unnecessary `anon` table GRANTs (`remote_schema.sql:780+`); add an app-layer session-ownership check in `plans/refine` (`route.ts:53-67`, currently RLS-only); explicit auth checks in `plans/catalog` and `plans/template/[templateId]` (currently middleware-only); de-duplicate the athlete fetch in `agent/chat/route.ts:74-78`; scope the auto-sync `sessionStorage` key per user and skip `router.refresh()` when nothing synced (`auto-sync.tsx:58-65`); consolidate the `radix-ui` barrel package vs the 17 scoped `@radix-ui/*` packages.

---

## What's already good

- **RLS everywhere**: all 21 tables, `is_own_athlete()` SECURITY DEFINER with pinned `search_path`, anon EXECUTE revoked on RPCs (`20260527000000_security_advisor_fixes.sql`). Only `USING (true)` policies are read-only shared catalogs.
- **Defense-in-depth on routes**: global middleware gate + per-route `auth.getUser()` + explicit `athlete_id` filters; ownership verified before mutations; admin-only destructive routes gated by `isUserAdmin`; service-role key confined to 4 guarded routes.
- **No XSS surface**: no raw HTML rendering anywhere; `react-markdown` without `rehype-raw`; `javascript:` hrefs stripped by default.
- **LLM safety**: keys server-only; no eval/dynamic execution; all tool actions human-approved; strength proposals re-validated server-side.
- **OAuth**: Strava CSRF state in httpOnly cookie, verified in callback; relative redirects only; Garmin password not persisted.
- **Hygiene**: Zod validation with bounded fields across routes; settings update uses an allowlist (no mass-assignment); env validation at startup; nothing sensitive ever committed (verified against git history); `coach-context-loader.ts` and the dashboard-stats RPC are model implementations to copy from.
