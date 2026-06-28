-- Imported running plans: a private, per-user library of running programs the
-- user owns (book / app / screenshot) and follows in the app.
--
-- The `definition` jsonb is a normalized, ordered week sequence (a
-- ParsedRunningPlan — see lib/plans/import/schemas.ts). It is the reusable
-- source of truth: each "apply" fits the definition onto a window/race and
-- materializes an ordinary training_plans row (phases -> weekly_plans ->
-- planned_workouts). Raw source text / screenshots are NOT retained at rest —
-- they live only in the transient parse->review request, and screenshots are
-- discarded on accept (copyright). These rows never enter the shared template
-- catalog; RLS keeps them owner-only.

-- ---------------------------------------------------------------------------
-- imported_run_plans: one row per imported plan definition (reusable)
-- ---------------------------------------------------------------------------
create table public.imported_run_plans (
  id                    bigserial primary key,
  athlete_id            uuid not null references public.athletes(id) on delete cascade,
  name                  text not null,
  source_type           text not null check (source_type in ('free_text','json','image')),
  source_provider       text,
  source_model          text,
  parse_confidence      numeric(3,2),
  parse_metadata        jsonb,
  definition            jsonb not null,
  distance              text,
  default_days_per_week integer check (default_days_per_week between 1 and 7),
  total_weeks           integer not null check (total_weeks between 1 and 104),
  status                text not null default 'active' check (status in ('active','deleted')),
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

create index idx_imported_run_plans_athlete_status
  on public.imported_run_plans(athlete_id, status);

alter table public.imported_run_plans enable row level security;

create policy "Users can view own imported run plans"
  on public.imported_run_plans as permissive for select to authenticated
  using (public.is_own_athlete(athlete_id));

create policy "Users can insert own imported run plans"
  on public.imported_run_plans as permissive for insert to public
  with check (public.is_own_athlete(athlete_id));

create policy "Users can update own imported run plans"
  on public.imported_run_plans as permissive for update to public
  using (public.is_own_athlete(athlete_id));

create policy "Users can delete own imported run plans"
  on public.imported_run_plans as permissive for delete to public
  using (public.is_own_athlete(athlete_id));

grant select, insert, update, delete on public.imported_run_plans to authenticated;
grant select, insert, update, delete on public.imported_run_plans to service_role;
grant usage, select on sequence public.imported_run_plans_id_seq to authenticated;
grant usage, select on sequence public.imported_run_plans_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- training_plans provenance: link a materialized plan back to its import.
-- Both nullable; generated plans leave them null.
-- ---------------------------------------------------------------------------
alter table public.training_plans
  add column if not exists source text,
  add column if not exists imported_run_plan_id bigint
    references public.imported_run_plans(id) on delete set null;

-- ---------------------------------------------------------------------------
-- imported_run_plan_applications: definition -> materialized instances.
-- Lets the library show "applied N times" and drive quick re-apply.
-- ---------------------------------------------------------------------------
create table public.imported_run_plan_applications (
  id                   bigserial primary key,
  imported_run_plan_id bigint not null references public.imported_run_plans(id) on delete cascade,
  training_plan_id     bigint not null references public.training_plans(id) on delete cascade,
  athlete_id           uuid not null references public.athletes(id) on delete cascade,
  applied_start_date   date not null,
  applied_race_date    date,
  fit_mode             text not null check (fit_mode in ('exact','compress','stretch','llm_adapt')),
  created_at           timestamptz default now()
);

create index idx_irp_applications_plan
  on public.imported_run_plan_applications(imported_run_plan_id);

alter table public.imported_run_plan_applications enable row level security;

create policy "Users can view own irp applications"
  on public.imported_run_plan_applications as permissive for select to authenticated
  using (public.is_own_athlete(athlete_id));

create policy "Users can insert own irp applications"
  on public.imported_run_plan_applications as permissive for insert to public
  with check (public.is_own_athlete(athlete_id));

create policy "Users can delete own irp applications"
  on public.imported_run_plan_applications as permissive for delete to public
  using (public.is_own_athlete(athlete_id));

grant select, insert, update, delete on public.imported_run_plan_applications to authenticated;
grant select, insert, update, delete on public.imported_run_plan_applications to service_role;
grant usage, select on sequence public.imported_run_plan_applications_id_seq to authenticated;
grant usage, select on sequence public.imported_run_plan_applications_id_seq to service_role;
