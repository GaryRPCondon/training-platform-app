# Code Review — Security, Optimization, i18n & Accessibility

**Date:** 2026-06-10
**Scope:** Full repository — all API routes (~66), middleware (`proxy.ts`), Supabase layer + RLS migrations, Garmin/Strava integrations, AI agent layer, plan operations, analysis modules, and the React frontend. Part 2 covers internationalization/RTL readiness; Part 3 covers accessibility (WCAG 2.2 AA-oriented).

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

---

# Part 2 — Internationalization (i18n) & RTL Readiness

**Baseline (verified):** No i18n framework (no next-intl/i18next/react-intl in `package.json`), no locale routing or `Accept-Language` handling, `<html lang="en">` hardcoded with no `dir` attribute (`app/layout.tsx:29`), Geist fonts loaded with `subsets: ["latin"]` only. The app is English-only today; findings are scoped to what blocks or complicates localization.

## I-P1 — Structural blockers (fix before/with any localization effort)

### I1. ~1,000+ hardcoded user-facing strings — High
~360 inline JSX text nodes, **145 toast calls**, **273 API-route error strings** (which leak directly into the UI, e.g. `app/dashboard/sync/page.tsx:117` does `toast.error(data.error || 'Sync failed')`), 44 placeholders, 40 aria-labels. Worst offenders: `app/dashboard/plans/new/page.tsx` (long instructional copy with embedded arithmetic, lines 217, 426), `activities-view.tsx`, `sync/page.tsx`, `components/review/workout-card.tsx`.
**Fix:** adopt `next-intl` in no-routing mode (app is fully auth-gated); extract screen-by-screen. For API routes, return stable error **codes** alongside messages and map codes→translated toasts client-side, so the 273 server strings don't need locale plumbing.

### I2. English text persisted to the database — High (silent lock-in)
- Observation titles written at creation time: `lib/analysis/flag-detector.ts:36` — `` `${n} workout${n>1?'s':''} missed in the last 7 days` ``; adjustment titles/descriptions in `adjustment-proposer.ts:66-67,111-112,152-153`. Once stored, they can't render in another locale.
- LLM-generated plan/workout descriptions are stored in English; the prompt stack (`lib/agent/prompts.ts`, `coach-prompt.ts`, `lib/plans/llm-prompts.ts`) never instructs an output language — note `prompts.ts:95` already conditions units ("Always respond using miles…"), so the same mechanism can carry "Respond in {language}".
**Fix:** store message key + params (`{type:'missed_workouts', count:n}`) and localize at display time; add a language line to the coach system prompt.

### I3. Pluralization/concatenation hacks (~20 sites) — High under translation
`=== 1 ? '' : 's'` and sentence assembly from fragments: `sync/page.tsx:86` (`activit${'y'|'ies'}`), `training-calendar.tsx:520,731,776`, `activities-view.tsx:226,366,599,618`, `plan-chat-interface.tsx:245`, `plan-diff-preview.tsx:111` (plural suffix in a separate JSX node from its word). Break in any language with multiple plural categories (Arabic, Polish, Russian) or different word order. **Fix:** ICU MessageFormat plurals (free with next-intl).

## I-P2 — Date/number formatting (some are live bugs today)

### I4. UTC-midnight date parsing — **live bug for users west of Greenwich** — High
Some sites guard date-only strings (`+ 'T12:00:00'` in `chat/page.tsx:67`, `coach-prompt.ts:155,430`), but `plans/page.tsx:120,181,240` and `training-calendar.tsx:541-542` call `new Date('YYYY-MM-DD')` directly — parsed as UTC midnight, rendering one day early in UTC-negative timezones. **Fix:** standardize on `parseISO()` (already used correctly in `activity-detail.tsx:98`).

### I5. Week-start handling is split-brained — Medium (correctness)
`athlete.week_starts_on` is honored in the calendar/weekly-totals/phase-progress, but the **AI context loaders hardcode Monday** (`coach-context-loader.ts:380-381,467,500-502,531-532`, `context-loader.ts:73-74`) while `phase-progress.ts` defaults to Sunday. The AI coach and the UI can disagree about "this week." **Fix:** one `getWeekStart(athlete)` helper.

### I6. Locale-blind date formatting — Medium
Hardcoded `'en-US'`/`'en-GB'` in `app/dashboard/page.tsx:113`, `lib/chat/operation-prompts.ts:131,157`, `coach/route.ts:340`; ~40 date-fns `format()` display calls with English patterns and no `locale` arg (`'MMM d, yyyy'`, `'PPp'`, `'MMMM yyyy'`); 5 duplicated hardcoded day-name arrays (`lib/plans/operations/helpers.ts:12`, `phase-progress.ts:152`, etc.); `formatDistanceToNow` without locale (`session-list.tsx:72`). The `format(x, 'yyyy-MM-dd')` *data-key* calls are fine and should stay locale-independent. **Fix:** central `formatDate(date, style)` wrapper injecting locale.

### I7. Number/unit formatting — Medium
`lib/utils/units.ts` + `useUnits()` is the right architecture, but: 103 `toFixed()` call sites (always `12.5`, never `12,5`); unit labels concatenated with hardcoded order/spacing (`units.ts:62,77`); helper **bypasses** with inline `` `${(m/1000).toFixed(1)}km` `` in `chat/page.tsx:74`, `proposal-card.tsx:47,63,318`, `plan-preview/page.tsx:342`, plus `' bpm'`/`' m'` literals. **Fix:** route through `Intl.NumberFormat` (`style:'unit'`) inside the existing helpers; funnel bypasses through `useUnits()`.

## I-P3 — RTL hazards (specifically requested)

### I8. ~240 physical Tailwind direction classes; zero logical ones in app code — High (for RTL)
`mr-2` ×58, `text-right` ×19, `space-x-*` ×18 (no `rtl:space-x-reverse` anywhere), `border-l` ×10, `left-*` ×16, `pl-*` ×17, `rounded-l/r` ×7… Logical properties (`ms-/me-/ps-/pe-/start-/end-`) appear **only** inside shadcn/ui primitives. **Fix:** mechanical codemod (`ml-→ms-`, `mr-→me-`, `pl-→ps-`, `pr-→pe-`, `left-→start-`, `text-left→text-start`, `space-x-N→gap-N`); Tailwind v4 supports all logical utilities natively, and they're no-ops in LTR so this can land early.

### I9. Navigation drawer hardwired to the left edge — High (for RTL)
`components/shared/navigation.tsx:137` — `fixed left-0 ... slide-out-to-left slide-in-from-left border-r`. Must mirror under RTL: `start-0`, `border-e`, dir-conditional slide animations.

### I10. Directional icons that must flip — Medium
`ChevronLeft/Right` prev/next in `custom-toolbar.tsx:42,56`; `ArrowLeft` back buttons in `plans/recommend/page.tsx:139,158,241`, `plans/review/[planId]/page.tsx:121`; `ArrowRight` as before→after indicator in `operations-preview.tsx:98`. **Fix:** `rtl:rotate-180` — `components/ui/calendar.tsx:33-34` already does this correctly and is the in-repo pattern to copy.

### I11. react-big-calendar RTL — Medium
None of the 4 RBC instances pass the `rtl` prop (supported); momentLocalizer pinned to `'en'` (`training-calendar.tsx:272`, mutated in render). Drag-reschedule is date-cell based so it survives mirroring, but the weekly-totals side column, strength-day-cell overlays, and the CLAUDE.md-flagged fragile grid layout make this a careful-test zone. Switching to `dateFnsLocalizer` (also perf item P3.1) gets locale + drops moment in one move.

### I12. Bidi/mixed-direction text — Medium
Paces ("5:30/km"), clock times, and workout codes (`W14:D6`) interpolated into sentences will scramble next to Arabic/Hebrew text; user activity names from Garmin/Strava are interpolated raw. Zero `translate=` usage in the codebase — pace notation, "VDOT", workout codes, and brand names should get `translate="no"` to survive Chrome auto-translate **even before real i18n lands**. **Fix:** wrap numeric/pace/code tokens in `<span dir="ltr" translate="no">`.

### I13. Infrastructure gaps — Low/Medium
No per-user `locale` column (natural home: `athletes`, next to `preferred_units`/`week_starts_on`); text-expansion risk in `w-[240px]` drawer, `h-7 px-3 text-xs` toolbar buttons, 11 `truncate` sites (German runs ~30% longer); add non-Latin font subsets when RTL locales land. `localeCompare` uses compare ISO date keys — fine.

## Already i18n-friendly
Metric-only storage with display-boundary conversion (`lib/utils/units.ts`); `useUnits()` is a ready-made locale injection point; ISO `yyyy-MM-dd` as data keys (clean data/presentation separation); Zod errors return structured field-level `details`; `ui/calendar.tsx` already RTL-flips its icons; Radix follows document `dir` automatically once set.

## Migration path (pragmatic)
- **Phase 0 (cheap, do regardless):** fix I4 (parseISO) and I5 (week-start helper) — these are live bugs; remove hardcoded `'en-US'`; add `translate="no"`/`dir="ltr"` spans for paces/codes; route unit-formatting bypasses through `useUnits()`.
- **Phase 1:** next-intl without locale routing; `locale` column on athletes; `<html lang dir>` from provider; extract strings worst-offenders-first; ICU plurals; error codes from API routes; key+params for persisted observation/adjustment titles; "respond in {language}" in the coach prompt.
- **Phase 2 (RTL):** Tailwind logical-properties codemod (can land early); icon flips; mirror nav drawer; RBC `rtl` prop + `dateFnsLocalizer`; regression-test the fragile calendar layout.

---

# Part 3 — Accessibility (WCAG 2.2 AA-oriented)

*Note: contrast ratios and screen-reader behavior need runtime verification (axe/Lighthouse + NVDA/VoiceOver pass); findings below are from static review.*

## A-P1 — High (blocks or seriously impedes AT/keyboard users)

### A1. Chat: streamed AI responses are not announced — High (WCAG 4.1.3)
`components/chat/coach-interface.tsx` — no `aria-live` region anywhere; a screen-reader user gets no notification that the AI coach replied, and the "Analysing your training data…/Thinking…" indicator (lines 363-374) is likewise silent. The send Textarea (line ~381) has only a placeholder — no label/`aria-label` (placeholder is not a reliable accessible name).
**Fix:** wrap the latest assistant message (or a visually-hidden status node) in `aria-live="polite"`; announce "AI Coach is responding…" on send and completion; add `aria-label="Message your AI Coach"` to the Textarea. Same review for `chat-interface.tsx` and `plan-chat-interface.tsx`.

### A2. Calendar events: keyboard reachability unverified; reschedule likely drag-only via keyboard — High (WCAG 2.1.1)
`components/calendar/training-calendar.tsx` — react-big-calendar month-view events are not keyboard-focusable by default (known RBC gap), and no `onKeyPressEvent` handler is wired. The good news: the workout dialog renders `WorkoutCard` with a fully keyboard-operable date-picker reschedule (`workout-card.tsx:1304,1420-1434`), so the *capability* exists — the gap is *reaching* an event without a mouse.
**Fix:** wire RBC's `onKeyPressEvent` and provide a focusable custom event component, or add a list-view alternative ("This week" list with per-workout actions). Verify with a keyboard-only pass.

### A3. Color-only status encoding on calendar events — High (WCAG 1.4.1)
`training-calendar.tsx:608-660` — workout type is conveyed by background color and completion status (completed/partial/skipped) solely by a 4px left-border color (green/yellow/red) plus opacity. Color-blind users cannot distinguish completed from skipped.
**Fix:** add a status glyph (✓/½/✗ or lucide icon) to the event title/custom event component; the weekly chart (`weekly-progress-chart.tsx:61-66`) has the same emerald/rose color-only status issue.

## A-P2 — Medium

### A4. Icon-only buttons inconsistently labeled — Medium (WCAG 4.1.2)
Good examples exist (`custom-toolbar.tsx:40,55` prev/next labeled; `workout-card.tsx:1349,1376`; `header.tsx:62`), but the activities-table **delete** button (`activities-view.tsx:485-492`, Trash2 icon) has no `aria-label` (its labeled "Discuss with AI Coach" sibling shows the intended pattern), and several `size="icon"` buttons in `session-detail-dialog.tsx:383-488`, `exercise-edit-row.tsx:57`, `review/chat-panel.tsx:104`, `workout-card.tsx:338,555,1361,1388,1404` need an audit. **Fix:** sweep all ~23 `size="icon"` sites; every one needs `aria-label`.

### A5. Charts rely on `title` tooltips — Medium (WCAG 1.1.1)
`weekly-progress-chart.tsx:37-83` — planned/actual bars are divs whose values are exposed only via `title` attributes (mouse-only; invisible to keyboard and most SR users). Actual values render as visible text (good); planned values don't. **Fix:** add an sr-only per-day summary ("Tuesday: planned 8 km, completed 7.5 km") or render the chart with a visually-hidden table; also fixes the 10px text minimum concern.

### A6. No skip link; no `prefers-reduced-motion` handling — Medium (WCAG 2.4.1, 2.3.3)
Landmarks are good (`<main>` in `dashboard/layout.tsx:17`, `<nav aria-label="Main navigation">`, `<header>`, `aria-current="page"` on nav items) but there's no skip-to-content link, and zero `motion-reduce:` usage — chat smooth-scroll (`coach-interface.tsx:140`), `animate-spin` loaders, and tw-animate-css transitions all ignore the user's motion preference. **Fix:** skip link in `app/layout.tsx`; `motion-reduce:` variants / `scrollIntoView({behavior: matchMedia('(prefers-reduced-motion)').matches ? 'auto' : 'smooth'})`.

### A7. Async/loading states not announced — Medium (WCAG 4.1.3)
Sync progress (`sync/page.tsx`), auto-match ("Matching…"), and AI summary polling (`ai-summary-panel.tsx`) update visually with no `role="status"`/`aria-live`. Sonner toasts ARE announced (built-in aria-live) — they partially cover this, but in-page progress indicators should carry `role="status"`. Loading states that `return null` (dashboard cards) also give SR users nothing; render labeled skeletons instead.

## A-P3 — Low / verify at runtime

- **A8.** Activities table (`activities-view.tsx:396+`): verify `TableHead` renders `<th scope="col">` (shadcn default is `<th>` without scope — usually acceptable), add a caption or `aria-label` on the table; the duplicated hidden mobile/desktop DOM (perf finding P3.7) also doubles what SRs traverse — fixing one fixes both.
- **A9.** Contrast audit needed at runtime: heavy use of `text-muted-foreground`, white text on per-workout-type colors (`getWorkoutColor` backgrounds with `color:#fff`, opacity 0.35–0.9 variants), 10px chart labels, `text-xs` toolbar buttons.
- **A10.** `components/activities/platform-icons.tsx` — verify Garmin/Strava source icons carry sr-only text (the source platform is meaning-bearing in merge review).
- **A11.** Dialog hygiene is **good**: every `DialogContent` in the app has a `DialogTitle` (several correctly `sr-only`); Radix provides focus trap/restore; mobile nav toggle has `sr-only` text; login form has proper `htmlFor` labels; settings selects are labeled via `id`/`htmlFor`.

## Top 5 a11y fixes by impact
1. **A1** — aria-live for chat responses + label the chat input (the app's core feature is currently silent to SR users).
2. **A2** — keyboard path to calendar events (capability exists in the dialog; make events reachable).
3. **A3** — non-color status indicators on calendar events and weekly chart.
4. **A4** — label the ~dozen unlabeled icon-only buttons (mechanical, an afternoon).
5. **A6** — skip link + reduced-motion variants (small, broad benefit).
