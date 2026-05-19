-- Strength & Mobility module: parent programs, scheduled sessions, exercise catalog.
-- Sessions store their own scheduled_date so they can be rendered on the main calendar
-- alongside running workouts without touching weekly_plans / planned_workouts.

-- ---------------------------------------------------------------------------
-- strength_programs: one row per imported plan
-- ---------------------------------------------------------------------------
create table public.strength_programs (
  id              bigserial primary key,
  athlete_id      uuid not null references public.athletes(id) on delete cascade,
  name            text not null,
  source_text     text,
  source_format   text not null check (source_format in ('free_text','json')),
  parsed_program  jsonb not null,
  parse_confidence numeric(3,2),
  parse_metadata  jsonb,
  cadence_days    integer not null default 2 check (cadence_days between 1 and 7),
  start_date      date not null,
  status          text not null default 'active' check (status in ('active','completed','deleted')),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index idx_strength_programs_athlete_status on public.strength_programs(athlete_id, status);

alter table public.strength_programs enable row level security;

create policy "Users can view own strength programs"
  on public.strength_programs as permissive for select to authenticated
  using (public.is_own_athlete(athlete_id));

create policy "Users can insert own strength programs"
  on public.strength_programs as permissive for insert to public
  with check (public.is_own_athlete(athlete_id));

create policy "Users can update own strength programs"
  on public.strength_programs as permissive for update to public
  using (public.is_own_athlete(athlete_id));

create policy "Users can delete own strength programs"
  on public.strength_programs as permissive for delete to public
  using (public.is_own_athlete(athlete_id));

grant select, insert, update, delete on public.strength_programs to authenticated;
grant select, insert, update, delete on public.strength_programs to service_role;
grant usage, select on sequence public.strength_programs_id_seq to authenticated;
grant usage, select on sequence public.strength_programs_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- strength_sessions: one row per scheduled session
-- ---------------------------------------------------------------------------
create table public.strength_sessions (
  id                         bigserial primary key,
  program_id                 bigint references public.strength_programs(id) on delete cascade,
  athlete_id                 uuid not null references public.athletes(id) on delete cascade,
  session_index              integer not null,
  scheduled_date             date not null,
  display_order              integer not null default 1,
  title                      text not null,
  exercises                  jsonb not null,
  estimated_duration_minutes integer,
  placement_rationale        text,
  coaching_note              text,
  completion_status          text not null default 'pending'
                             check (completion_status in ('pending','completed','partial','skipped')),
  completed_at               timestamptz,
  actual_duration_minutes    integer,
  completion_notes           text,
  garmin_workout_id          text,
  garmin_scheduled_at        timestamptz,
  garmin_sync_status         text check (garmin_sync_status in ('synced','stale','failed','unsupported')),
  garmin_sync_metadata       jsonb,
  created_at                 timestamptz default now(),
  updated_at                 timestamptz default now(),
  unique (program_id, session_index)
);

create index idx_strength_sessions_athlete_date on public.strength_sessions(athlete_id, scheduled_date);
create index idx_strength_sessions_program on public.strength_sessions(program_id);

alter table public.strength_sessions enable row level security;

create policy "Users can view own strength sessions"
  on public.strength_sessions as permissive for select to authenticated
  using (public.is_own_athlete(athlete_id));

create policy "Users can insert own strength sessions"
  on public.strength_sessions as permissive for insert to public
  with check (public.is_own_athlete(athlete_id));

create policy "Users can update own strength sessions"
  on public.strength_sessions as permissive for update to public
  using (public.is_own_athlete(athlete_id));

create policy "Users can delete own strength sessions"
  on public.strength_sessions as permissive for delete to public
  using (public.is_own_athlete(athlete_id));

grant select, insert, update, delete on public.strength_sessions to authenticated;
grant select, insert, update, delete on public.strength_sessions to service_role;
grant usage, select on sequence public.strength_sessions_id_seq to authenticated;
grant usage, select on sequence public.strength_sessions_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- strength_exercise_catalog: static lookup, shared across athletes
-- ---------------------------------------------------------------------------
create table public.strength_exercise_catalog (
  id                       bigserial primary key,
  canonical_name           text not null unique,
  display_name             text not null,
  aliases                  text[] not null default '{}',
  measurement_type         text not null check (measurement_type in ('reps','duration','distance')),
  garmin_exercise_category text,
  garmin_exercise_name     text,
  garmin_step_type         text not null default 'STRENGTH' check (garmin_step_type in ('STRENGTH','CARDIO','OTHER')),
  garmin_supported         boolean not null default false,
  created_at               timestamptz default now()
);

alter table public.strength_exercise_catalog enable row level security;

create policy "Authenticated users can read exercise catalog"
  on public.strength_exercise_catalog as permissive for select to authenticated
  using (true);
-- No insert/update/delete policies; service role only via seed script.

grant select on public.strength_exercise_catalog to authenticated;
grant select, insert, update, delete on public.strength_exercise_catalog to service_role;
grant usage, select on sequence public.strength_exercise_catalog_id_seq to service_role;
