drop extension if exists "pg_net";

create sequence "public"."activities_id_seq";

create sequence "public"."activity_streams_id_seq";

create sequence "public"."athlete_constraints_id_seq";

create sequence "public"."athlete_goals_id_seq";

create sequence "public"."athlete_integrations_id_seq";

create sequence "public"."chat_messages_id_seq";

create sequence "public"."chat_sessions_id_seq";

create sequence "public"."health_metrics_id_seq";

create sequence "public"."laps_id_seq";

create sequence "public"."phase_progress_id_seq";

create sequence "public"."plan_adjustments_id_seq";

create sequence "public"."planned_workouts_id_seq";

create sequence "public"."sync_log_id_seq";

create sequence "public"."training_phases_id_seq";

create sequence "public"."training_plans_id_seq";

create sequence "public"."weekly_plans_id_seq";

create sequence "public"."workout_feedback_id_seq";

create sequence "public"."workout_flags_id_seq";


  create table "public"."activities" (
    "id" integer not null default nextval('public.activities_id_seq'::regclass),
    "athlete_id" uuid not null,
    "garmin_id" bigint,
    "strava_id" bigint,
    "source" text not null,
    "activity_name" text,
    "activity_type" text,
    "start_time" timestamp with time zone not null,
    "distance_meters" double precision,
    "duration_seconds" double precision,
    "moving_duration_seconds" double precision,
    "elevation_gain_meters" double precision,
    "elevation_loss_meters" double precision,
    "avg_hr" integer,
    "max_hr" integer,
    "min_hr" integer,
    "avg_power" double precision,
    "max_power" double precision,
    "normalized_power" double precision,
    "avg_cadence" double precision,
    "max_cadence" double precision,
    "calories" integer,
    "perceived_effort" integer,
    "notes" text,
    "planned_workout_id" integer,
    "garmin_data" jsonb,
    "strava_data" jsonb,
    "synced_from_garmin" timestamp with time zone,
    "synced_from_strava" timestamp with time zone,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."activities" enable row level security;


  create table "public"."activity_streams" (
    "id" integer not null default nextval('public.activity_streams_id_seq'::regclass),
    "activity_id" integer not null,
    "stream_type" text not null,
    "data" jsonb not null,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."activity_streams" enable row level security;


  create table "public"."athlete_constraints" (
    "id" integer not null default nextval('public.athlete_constraints_id_seq'::regclass),
    "athlete_id" uuid,
    "constraint_type" text not null,
    "constraint_data" jsonb not null,
    "active" boolean default true,
    "created_from_chat_id" integer,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."athlete_constraints" enable row level security;


  create table "public"."athlete_goals" (
    "id" integer not null default nextval('public.athlete_goals_id_seq'::regclass),
    "athlete_id" uuid not null,
    "goal_type" text not null,
    "goal_name" text not null,
    "target_date" date,
    "target_value" jsonb,
    "status" text default 'active'::text,
    "priority" integer default 1,
    "created_at" timestamp with time zone default now(),
    "completed_at" timestamp with time zone
      );


alter table "public"."athlete_goals" enable row level security;


  create table "public"."athlete_integrations" (
    "id" integer not null default nextval('public.athlete_integrations_id_seq'::regclass),
    "athlete_id" uuid,
    "platform" text not null,
    "platform_athlete_id" text,
    "access_token_encrypted" text,
    "refresh_token_encrypted" text,
    "token_expires_at" timestamp with time zone,
    "connected_at" timestamp with time zone default now(),
    "last_synced_at" timestamp with time zone,
    "access_token" text,
    "refresh_token" text,
    "scope" text
      );


alter table "public"."athlete_integrations" enable row level security;


  create table "public"."athletes" (
    "id" uuid not null default gen_random_uuid(),
    "email" text not null,
    "name" text,
    "date_of_birth" date,
    "gender" text,
    "max_hr" integer,
    "resting_hr" integer,
    "threshold_pace" double precision,
    "threshold_power" double precision,
    "vo2_max" double precision,
    "preferred_units" text default 'metric'::text,
    "timezone" text,
    "garmin_connected" boolean default false,
    "strava_connected" boolean default false,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now(),
    "preferred_llm_provider" text default 'gemini'::text,
    "preferred_llm_model" text,
    "week_starts_on" integer default 0
      );


alter table "public"."athletes" enable row level security;


  create table "public"."chat_messages" (
    "id" integer not null default nextval('public.chat_messages_id_seq'::regclass),
    "session_id" integer not null,
    "role" text not null,
    "content" text not null,
    "action_taken" jsonb,
    "metadata" jsonb,
    "created_at" timestamp with time zone default now(),
    "provider" text,
    "model" text,
    "token_usage" jsonb
      );


alter table "public"."chat_messages" enable row level security;


  create table "public"."chat_sessions" (
    "id" integer not null default nextval('public.chat_sessions_id_seq'::regclass),
    "athlete_id" uuid not null,
    "session_type" text not null,
    "weekly_plan_id" integer,
    "specific_workout_id" integer,
    "context" jsonb,
    "started_at" timestamp with time zone default now(),
    "ended_at" timestamp with time zone
      );


alter table "public"."chat_sessions" enable row level security;


  create table "public"."health_metrics" (
    "id" integer not null default nextval('public.health_metrics_id_seq'::regclass),
    "athlete_id" uuid not null,
    "date" date not null,
    "sleep_score" integer,
    "sleep_duration_minutes" integer,
    "resting_hr" integer,
    "hrv" double precision,
    "body_battery" integer,
    "stress_avg" integer,
    "readiness_score" integer,
    "steps" integer,
    "weight_kg" double precision,
    "raw_data" jsonb,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."health_metrics" enable row level security;


  create table "public"."laps" (
    "id" integer not null default nextval('public.laps_id_seq'::regclass),
    "activity_id" integer not null,
    "lap_index" integer not null,
    "distance_meters" double precision,
    "duration_seconds" double precision,
    "avg_hr" integer,
    "max_hr" integer,
    "avg_power" double precision,
    "avg_pace" double precision,
    "elevation_gain_meters" double precision,
    "raw_data" jsonb
      );


alter table "public"."laps" enable row level security;


  create table "public"."phase_progress" (
    "id" integer not null default nextval('public.phase_progress_id_seq'::regclass),
    "phase_id" integer not null,
    "week_number" integer not null,
    "planned_volume_km" double precision,
    "actual_volume_km" double precision,
    "volume_gap_km" double precision,
    "planned_workouts_by_type" jsonb,
    "actual_workouts_by_type" jsonb,
    "missing_workout_types" jsonb,
    "gap_severity" text,
    "catch_up_possible" boolean,
    "computed_at" timestamp with time zone default now()
      );


alter table "public"."phase_progress" enable row level security;


  create table "public"."plan_adjustments" (
    "id" integer not null default nextval('public.plan_adjustments_id_seq'::regclass),
    "athlete_id" uuid not null,
    "weekly_plan_id" integer,
    "adjustment_reason" text not null,
    "original_workout_id" integer,
    "adjustment_type" text not null,
    "agent_recommended" boolean default false,
    "adjusted_at" timestamp with time zone default now(),
    "notes" text,
    "title" text,
    "description" text,
    "rationale" text,
    "impact" text,
    "affected_workout_ids" integer[],
    "status" text default 'pending'::text,
    "applied_at" timestamp with time zone
      );


alter table "public"."plan_adjustments" enable row level security;


  create table "public"."planned_workouts" (
    "id" integer not null default nextval('public.planned_workouts_id_seq'::regclass),
    "weekly_plan_id" integer,
    "athlete_id" uuid not null,
    "scheduled_date" date not null,
    "scheduled_time" time without time zone,
    "workout_type" text not null,
    "description" text,
    "distance_target_meters" double precision,
    "duration_target_seconds" integer,
    "intensity_target" text,
    "structured_workout" jsonb,
    "status" text default 'scheduled'::text,
    "completed_activity_id" integer,
    "agent_rationale" text,
    "agent_decision_metadata" jsonb,
    "notes" text,
    "version" integer default 1,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now(),
    "workout_index" text
      );


alter table "public"."planned_workouts" enable row level security;


  create table "public"."sync_log" (
    "id" integer not null default nextval('public.sync_log_id_seq'::regclass),
    "athlete_id" uuid not null,
    "source" text not null,
    "sync_type" text not null,
    "last_synced_at" timestamp with time zone not null,
    "records_fetched" integer,
    "status" text not null,
    "error_message" text,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."sync_log" enable row level security;


  create table "public"."training_phases" (
    "id" integer not null default nextval('public.training_phases_id_seq'::regclass),
    "plan_id" integer not null,
    "phase_name" text not null,
    "phase_order" integer not null,
    "start_date" date not null,
    "end_date" date not null,
    "weekly_volume_target" double precision,
    "max_weekly_volume" double precision,
    "max_long_run_distance" double precision,
    "intensity_distribution" jsonb,
    "scheduling_preferences" jsonb,
    "description" text
      );


alter table "public"."training_phases" enable row level security;


  create table "public"."training_plans" (
    "id" integer not null default nextval('public.training_plans_id_seq'::regclass),
    "athlete_id" uuid not null,
    "goal_id" integer,
    "name" text not null,
    "start_date" date not null,
    "end_date" date not null,
    "plan_type" text,
    "status" text default 'draft'::text,
    "created_by" text,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now(),
    "template_id" text,
    "template_version" text default '1.0'::text,
    "user_criteria" jsonb
      );


alter table "public"."training_plans" enable row level security;


  create table "public"."weekly_plans" (
    "id" integer not null default nextval('public.weekly_plans_id_seq'::regclass),
    "phase_id" integer,
    "athlete_id" uuid not null,
    "week_start_date" date not null,
    "week_number" integer,
    "weekly_volume_target" double precision,
    "weekly_load_target" integer,
    "status" text default 'planned'::text,
    "agent_rationale" text,
    "agent_decision_metadata" jsonb,
    "notes" text,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."weekly_plans" enable row level security;


  create table "public"."workout_feedback" (
    "id" integer not null default nextval('public.workout_feedback_id_seq'::regclass),
    "athlete_id" uuid not null,
    "planned_workout_id" integer,
    "activity_id" integer,
    "felt_difficulty" integer,
    "compared_to_plan" text,
    "injury_concern" boolean default false,
    "injury_description" text,
    "fatigue_level" integer,
    "sleep_quality" integer,
    "what_worked_well" text,
    "what_didnt_work" text,
    "feedback_text" text,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."workout_feedback" enable row level security;


  create table "public"."workout_flags" (
    "id" integer not null default nextval('public.workout_flags_id_seq'::regclass),
    "planned_workout_id" integer,
    "activity_id" integer,
    "flag_type" text not null,
    "severity" text not null,
    "flag_data" jsonb not null,
    "acknowledged" boolean default false,
    "created_at" timestamp with time zone default now(),
    "athlete_id" uuid
      );


alter table "public"."workout_flags" enable row level security;

alter sequence "public"."activities_id_seq" owned by "public"."activities"."id";

alter sequence "public"."activity_streams_id_seq" owned by "public"."activity_streams"."id";

alter sequence "public"."athlete_constraints_id_seq" owned by "public"."athlete_constraints"."id";

alter sequence "public"."athlete_goals_id_seq" owned by "public"."athlete_goals"."id";

alter sequence "public"."athlete_integrations_id_seq" owned by "public"."athlete_integrations"."id";

alter sequence "public"."chat_messages_id_seq" owned by "public"."chat_messages"."id";

alter sequence "public"."chat_sessions_id_seq" owned by "public"."chat_sessions"."id";

alter sequence "public"."health_metrics_id_seq" owned by "public"."health_metrics"."id";

alter sequence "public"."laps_id_seq" owned by "public"."laps"."id";

alter sequence "public"."phase_progress_id_seq" owned by "public"."phase_progress"."id";

alter sequence "public"."plan_adjustments_id_seq" owned by "public"."plan_adjustments"."id";

alter sequence "public"."planned_workouts_id_seq" owned by "public"."planned_workouts"."id";

alter sequence "public"."sync_log_id_seq" owned by "public"."sync_log"."id";

alter sequence "public"."training_phases_id_seq" owned by "public"."training_phases"."id";

alter sequence "public"."training_plans_id_seq" owned by "public"."training_plans"."id";

alter sequence "public"."weekly_plans_id_seq" owned by "public"."weekly_plans"."id";

alter sequence "public"."workout_feedback_id_seq" owned by "public"."workout_feedback"."id";

alter sequence "public"."workout_flags_id_seq" owned by "public"."workout_flags"."id";

CREATE UNIQUE INDEX activities_athlete_id_garmin_id_key ON public.activities USING btree (athlete_id, garmin_id);

CREATE UNIQUE INDEX activities_athlete_id_strava_id_key ON public.activities USING btree (athlete_id, strava_id);

CREATE UNIQUE INDEX activities_pkey ON public.activities USING btree (id);

CREATE UNIQUE INDEX activity_streams_activity_id_stream_type_key ON public.activity_streams USING btree (activity_id, stream_type);

CREATE UNIQUE INDEX activity_streams_pkey ON public.activity_streams USING btree (id);

CREATE UNIQUE INDEX athlete_constraints_pkey ON public.athlete_constraints USING btree (id);

CREATE UNIQUE INDEX athlete_goals_pkey ON public.athlete_goals USING btree (id);

CREATE UNIQUE INDEX athlete_integrations_athlete_id_platform_key ON public.athlete_integrations USING btree (athlete_id, platform);

CREATE UNIQUE INDEX athlete_integrations_pkey ON public.athlete_integrations USING btree (id);

CREATE UNIQUE INDEX athletes_email_key ON public.athletes USING btree (email);

CREATE UNIQUE INDEX athletes_pkey ON public.athletes USING btree (id);

CREATE UNIQUE INDEX chat_messages_pkey ON public.chat_messages USING btree (id);

CREATE UNIQUE INDEX chat_sessions_pkey ON public.chat_sessions USING btree (id);

CREATE UNIQUE INDEX health_metrics_athlete_id_date_key ON public.health_metrics USING btree (athlete_id, date);

CREATE UNIQUE INDEX health_metrics_pkey ON public.health_metrics USING btree (id);

CREATE INDEX idx_activities_athlete_date ON public.activities USING btree (athlete_id, start_time DESC);

CREATE INDEX idx_activities_garmin_id ON public.activities USING btree (garmin_id) WHERE (garmin_id IS NOT NULL);

CREATE INDEX idx_activities_planned_workout ON public.activities USING btree (planned_workout_id) WHERE (planned_workout_id IS NOT NULL);

CREATE INDEX idx_activities_strava_id ON public.activities USING btree (strava_id) WHERE (strava_id IS NOT NULL);

CREATE INDEX idx_athlete_integrations_expires ON public.athlete_integrations USING btree (athlete_id, platform, token_expires_at);

CREATE INDEX idx_chat_messages_provider ON public.chat_messages USING btree (provider) WHERE (provider IS NOT NULL);

CREATE INDEX idx_chat_messages_session ON public.chat_messages USING btree (session_id, created_at);

CREATE INDEX idx_chat_sessions_athlete ON public.chat_sessions USING btree (athlete_id, started_at DESC);

CREATE INDEX idx_health_metrics_athlete_date ON public.health_metrics USING btree (athlete_id, date DESC);

CREATE INDEX idx_planned_workouts_athlete_date ON public.planned_workouts USING btree (athlete_id, scheduled_date);

CREATE INDEX idx_planned_workouts_index ON public.planned_workouts USING btree (weekly_plan_id, workout_index);

CREATE INDEX idx_planned_workouts_status ON public.planned_workouts USING btree (athlete_id, status) WHERE (status = ANY (ARRAY['scheduled'::text, 'completed'::text]));

CREATE INDEX idx_weekly_plans_athlete_date ON public.weekly_plans USING btree (athlete_id, week_start_date);

CREATE INDEX idx_workout_feedback_athlete ON public.workout_feedback USING btree (athlete_id, created_at DESC);

CREATE INDEX idx_workout_flags_athlete ON public.workout_flags USING btree (athlete_id, acknowledged) WHERE (acknowledged = false);

CREATE INDEX idx_workout_flags_unacknowledged ON public.workout_flags USING btree (activity_id) WHERE (acknowledged = false);

CREATE UNIQUE INDEX laps_activity_id_lap_index_key ON public.laps USING btree (activity_id, lap_index);

CREATE UNIQUE INDEX laps_pkey ON public.laps USING btree (id);

CREATE UNIQUE INDEX phase_progress_phase_id_week_number_key ON public.phase_progress USING btree (phase_id, week_number);

CREATE UNIQUE INDEX phase_progress_pkey ON public.phase_progress USING btree (id);

CREATE UNIQUE INDEX plan_adjustments_pkey ON public.plan_adjustments USING btree (id);

CREATE UNIQUE INDEX planned_workouts_pkey ON public.planned_workouts USING btree (id);

CREATE UNIQUE INDEX sync_log_pkey ON public.sync_log USING btree (id);

CREATE UNIQUE INDEX training_phases_pkey ON public.training_phases USING btree (id);

CREATE UNIQUE INDEX training_phases_plan_id_phase_order_key ON public.training_phases USING btree (plan_id, phase_order);

CREATE UNIQUE INDEX training_plans_pkey ON public.training_plans USING btree (id);

CREATE UNIQUE INDEX weekly_plans_athlete_id_week_start_date_key ON public.weekly_plans USING btree (athlete_id, week_start_date);

CREATE UNIQUE INDEX weekly_plans_pkey ON public.weekly_plans USING btree (id);

CREATE UNIQUE INDEX workout_feedback_pkey ON public.workout_feedback USING btree (id);

CREATE UNIQUE INDEX workout_flags_pkey ON public.workout_flags USING btree (id);

alter table "public"."activities" add constraint "activities_pkey" PRIMARY KEY using index "activities_pkey";

alter table "public"."activity_streams" add constraint "activity_streams_pkey" PRIMARY KEY using index "activity_streams_pkey";

alter table "public"."athlete_constraints" add constraint "athlete_constraints_pkey" PRIMARY KEY using index "athlete_constraints_pkey";

alter table "public"."athlete_goals" add constraint "athlete_goals_pkey" PRIMARY KEY using index "athlete_goals_pkey";

alter table "public"."athlete_integrations" add constraint "athlete_integrations_pkey" PRIMARY KEY using index "athlete_integrations_pkey";

alter table "public"."athletes" add constraint "athletes_pkey" PRIMARY KEY using index "athletes_pkey";

alter table "public"."chat_messages" add constraint "chat_messages_pkey" PRIMARY KEY using index "chat_messages_pkey";

alter table "public"."chat_sessions" add constraint "chat_sessions_pkey" PRIMARY KEY using index "chat_sessions_pkey";

alter table "public"."health_metrics" add constraint "health_metrics_pkey" PRIMARY KEY using index "health_metrics_pkey";

alter table "public"."laps" add constraint "laps_pkey" PRIMARY KEY using index "laps_pkey";

alter table "public"."phase_progress" add constraint "phase_progress_pkey" PRIMARY KEY using index "phase_progress_pkey";

alter table "public"."plan_adjustments" add constraint "plan_adjustments_pkey" PRIMARY KEY using index "plan_adjustments_pkey";

alter table "public"."planned_workouts" add constraint "planned_workouts_pkey" PRIMARY KEY using index "planned_workouts_pkey";

alter table "public"."sync_log" add constraint "sync_log_pkey" PRIMARY KEY using index "sync_log_pkey";

alter table "public"."training_phases" add constraint "training_phases_pkey" PRIMARY KEY using index "training_phases_pkey";

alter table "public"."training_plans" add constraint "training_plans_pkey" PRIMARY KEY using index "training_plans_pkey";

alter table "public"."weekly_plans" add constraint "weekly_plans_pkey" PRIMARY KEY using index "weekly_plans_pkey";

alter table "public"."workout_feedback" add constraint "workout_feedback_pkey" PRIMARY KEY using index "workout_feedback_pkey";

alter table "public"."workout_flags" add constraint "workout_flags_pkey" PRIMARY KEY using index "workout_flags_pkey";

alter table "public"."activities" add constraint "activities_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE not valid;

alter table "public"."activities" validate constraint "activities_athlete_id_fkey";

alter table "public"."activities" add constraint "activities_athlete_id_garmin_id_key" UNIQUE using index "activities_athlete_id_garmin_id_key";

alter table "public"."activities" add constraint "activities_athlete_id_strava_id_key" UNIQUE using index "activities_athlete_id_strava_id_key";

alter table "public"."activity_streams" add constraint "activity_streams_activity_id_fkey" FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE not valid;

alter table "public"."activity_streams" validate constraint "activity_streams_activity_id_fkey";

alter table "public"."activity_streams" add constraint "activity_streams_activity_id_stream_type_key" UNIQUE using index "activity_streams_activity_id_stream_type_key";

alter table "public"."athlete_constraints" add constraint "athlete_constraints_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE not valid;

alter table "public"."athlete_constraints" validate constraint "athlete_constraints_athlete_id_fkey";

alter table "public"."athlete_goals" add constraint "athlete_goals_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE not valid;

alter table "public"."athlete_goals" validate constraint "athlete_goals_athlete_id_fkey";

alter table "public"."athlete_integrations" add constraint "athlete_integrations_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE not valid;

alter table "public"."athlete_integrations" validate constraint "athlete_integrations_athlete_id_fkey";

alter table "public"."athlete_integrations" add constraint "athlete_integrations_athlete_id_platform_key" UNIQUE using index "athlete_integrations_athlete_id_platform_key";

alter table "public"."athletes" add constraint "athletes_email_key" UNIQUE using index "athletes_email_key";

alter table "public"."athletes" add constraint "check_valid_llm_provider" CHECK ((preferred_llm_provider = ANY (ARRAY['anthropic'::text, 'openai'::text, 'gemini'::text, 'deepseek'::text, 'grok'::text]))) not valid;

alter table "public"."athletes" validate constraint "check_valid_llm_provider";

alter table "public"."chat_messages" add constraint "chat_messages_session_id_fkey" FOREIGN KEY (session_id) REFERENCES public.chat_sessions(id) ON DELETE CASCADE not valid;

alter table "public"."chat_messages" validate constraint "chat_messages_session_id_fkey";

alter table "public"."chat_sessions" add constraint "chat_sessions_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE not valid;

alter table "public"."chat_sessions" validate constraint "chat_sessions_athlete_id_fkey";

alter table "public"."chat_sessions" add constraint "chat_sessions_specific_workout_id_fkey" FOREIGN KEY (specific_workout_id) REFERENCES public.planned_workouts(id) not valid;

alter table "public"."chat_sessions" validate constraint "chat_sessions_specific_workout_id_fkey";

alter table "public"."chat_sessions" add constraint "chat_sessions_weekly_plan_id_fkey" FOREIGN KEY (weekly_plan_id) REFERENCES public.weekly_plans(id) not valid;

alter table "public"."chat_sessions" validate constraint "chat_sessions_weekly_plan_id_fkey";

alter table "public"."health_metrics" add constraint "health_metrics_athlete_id_date_key" UNIQUE using index "health_metrics_athlete_id_date_key";

alter table "public"."health_metrics" add constraint "health_metrics_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE not valid;

alter table "public"."health_metrics" validate constraint "health_metrics_athlete_id_fkey";

alter table "public"."laps" add constraint "laps_activity_id_fkey" FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE not valid;

alter table "public"."laps" validate constraint "laps_activity_id_fkey";

alter table "public"."laps" add constraint "laps_activity_id_lap_index_key" UNIQUE using index "laps_activity_id_lap_index_key";

alter table "public"."phase_progress" add constraint "phase_progress_phase_id_fkey" FOREIGN KEY (phase_id) REFERENCES public.training_phases(id) ON DELETE CASCADE not valid;

alter table "public"."phase_progress" validate constraint "phase_progress_phase_id_fkey";

alter table "public"."phase_progress" add constraint "phase_progress_phase_id_week_number_key" UNIQUE using index "phase_progress_phase_id_week_number_key";

alter table "public"."plan_adjustments" add constraint "plan_adjustments_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE not valid;

alter table "public"."plan_adjustments" validate constraint "plan_adjustments_athlete_id_fkey";

alter table "public"."plan_adjustments" add constraint "plan_adjustments_original_workout_id_fkey" FOREIGN KEY (original_workout_id) REFERENCES public.planned_workouts(id) not valid;

alter table "public"."plan_adjustments" validate constraint "plan_adjustments_original_workout_id_fkey";

alter table "public"."plan_adjustments" add constraint "plan_adjustments_weekly_plan_id_fkey" FOREIGN KEY (weekly_plan_id) REFERENCES public.weekly_plans(id) not valid;

alter table "public"."plan_adjustments" validate constraint "plan_adjustments_weekly_plan_id_fkey";

alter table "public"."planned_workouts" add constraint "planned_workouts_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE not valid;

alter table "public"."planned_workouts" validate constraint "planned_workouts_athlete_id_fkey";

alter table "public"."planned_workouts" add constraint "planned_workouts_completed_activity_id_fkey" FOREIGN KEY (completed_activity_id) REFERENCES public.activities(id) not valid;

alter table "public"."planned_workouts" validate constraint "planned_workouts_completed_activity_id_fkey";

alter table "public"."planned_workouts" add constraint "planned_workouts_weekly_plan_id_fkey" FOREIGN KEY (weekly_plan_id) REFERENCES public.weekly_plans(id) ON DELETE CASCADE not valid;

alter table "public"."planned_workouts" validate constraint "planned_workouts_weekly_plan_id_fkey";

alter table "public"."planned_workouts" add constraint "planned_workouts_workout_type_check" CHECK ((workout_type = ANY (ARRAY['easy_run'::text, 'long_run'::text, 'intervals'::text, 'tempo'::text, 'rest'::text, 'cross_training'::text, 'recovery'::text]))) not valid;

alter table "public"."planned_workouts" validate constraint "planned_workouts_workout_type_check";

alter table "public"."sync_log" add constraint "sync_log_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE not valid;

alter table "public"."sync_log" validate constraint "sync_log_athlete_id_fkey";

alter table "public"."training_phases" add constraint "training_phases_plan_id_fkey" FOREIGN KEY (plan_id) REFERENCES public.training_plans(id) ON DELETE CASCADE not valid;

alter table "public"."training_phases" validate constraint "training_phases_plan_id_fkey";

alter table "public"."training_phases" add constraint "training_phases_plan_id_phase_order_key" UNIQUE using index "training_phases_plan_id_phase_order_key";

alter table "public"."training_plans" add constraint "training_plans_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE not valid;

alter table "public"."training_plans" validate constraint "training_plans_athlete_id_fkey";

alter table "public"."training_plans" add constraint "training_plans_goal_id_fkey" FOREIGN KEY (goal_id) REFERENCES public.athlete_goals(id) not valid;

alter table "public"."training_plans" validate constraint "training_plans_goal_id_fkey";

alter table "public"."weekly_plans" add constraint "weekly_plans_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE not valid;

alter table "public"."weekly_plans" validate constraint "weekly_plans_athlete_id_fkey";

alter table "public"."weekly_plans" add constraint "weekly_plans_athlete_id_week_start_date_key" UNIQUE using index "weekly_plans_athlete_id_week_start_date_key";

alter table "public"."weekly_plans" add constraint "weekly_plans_phase_id_fkey" FOREIGN KEY (phase_id) REFERENCES public.training_phases(id) ON DELETE CASCADE not valid;

alter table "public"."weekly_plans" validate constraint "weekly_plans_phase_id_fkey";

alter table "public"."workout_feedback" add constraint "workout_feedback_activity_id_fkey" FOREIGN KEY (activity_id) REFERENCES public.activities(id) not valid;

alter table "public"."workout_feedback" validate constraint "workout_feedback_activity_id_fkey";

alter table "public"."workout_feedback" add constraint "workout_feedback_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE not valid;

alter table "public"."workout_feedback" validate constraint "workout_feedback_athlete_id_fkey";

alter table "public"."workout_feedback" add constraint "workout_feedback_planned_workout_id_fkey" FOREIGN KEY (planned_workout_id) REFERENCES public.planned_workouts(id) not valid;

alter table "public"."workout_feedback" validate constraint "workout_feedback_planned_workout_id_fkey";

alter table "public"."workout_flags" add constraint "workout_flags_activity_id_fkey" FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE not valid;

alter table "public"."workout_flags" validate constraint "workout_flags_activity_id_fkey";

alter table "public"."workout_flags" add constraint "workout_flags_athlete_id_fkey" FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) not valid;

alter table "public"."workout_flags" validate constraint "workout_flags_athlete_id_fkey";

alter table "public"."workout_flags" add constraint "workout_flags_planned_workout_id_fkey" FOREIGN KEY (planned_workout_id) REFERENCES public.planned_workouts(id) not valid;

alter table "public"."workout_flags" validate constraint "workout_flags_planned_workout_id_fkey";

set check_function_bodies = off;

create or replace view "public"."athlete_profile_summary" as  SELECT ( SELECT min(activities.start_time) AS min
           FROM public.activities
          WHERE (activities.athlete_id = a.id)) AS first_activity_date,
    preferred_units,
    name,
    id AS athlete_id,
    date_of_birth,
    ( SELECT count(*) AS count
           FROM public.activities
          WHERE (activities.athlete_id = a.id)) AS total_activities,
    ( SELECT max(activities.distance_meters) AS max
           FROM public.activities
          WHERE ((activities.athlete_id = a.id) AND (activities.activity_type = 'run'::text))) AS recent_long_run_distance,
    ( SELECT jsonb_agg(jsonb_build_object('type', athlete_constraints.constraint_type, 'data', athlete_constraints.constraint_data)) AS jsonb_agg
           FROM public.athlete_constraints
          WHERE ((athlete_constraints.athlete_id = a.id) AND (athlete_constraints.active = true))) AS active_constraints
   FROM public.athletes a
  WHERE (id = auth.uid());


create or replace view "public"."chat_history_with_provider" as  SELECT m.model,
    m.role,
    m.id,
    m.content,
    m.provider,
    s.session_type,
    m.token_usage,
    m.created_at,
    s.weekly_plan_id,
    s.athlete_id,
    m.session_id
   FROM (public.chat_messages m
     JOIN public.chat_sessions s ON ((m.session_id = s.id)))
  WHERE (s.athlete_id = auth.uid());


CREATE OR REPLACE FUNCTION public.is_own_athlete(check_athlete_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN check_athlete_id = auth.uid();
END;
$function$
;

grant delete on table "public"."activities" to "anon";

grant insert on table "public"."activities" to "anon";

grant references on table "public"."activities" to "anon";

grant select on table "public"."activities" to "anon";

grant trigger on table "public"."activities" to "anon";

grant truncate on table "public"."activities" to "anon";

grant update on table "public"."activities" to "anon";

grant delete on table "public"."activities" to "authenticated";

grant insert on table "public"."activities" to "authenticated";

grant references on table "public"."activities" to "authenticated";

grant select on table "public"."activities" to "authenticated";

grant trigger on table "public"."activities" to "authenticated";

grant truncate on table "public"."activities" to "authenticated";

grant update on table "public"."activities" to "authenticated";

grant delete on table "public"."activities" to "service_role";

grant insert on table "public"."activities" to "service_role";

grant references on table "public"."activities" to "service_role";

grant select on table "public"."activities" to "service_role";

grant trigger on table "public"."activities" to "service_role";

grant truncate on table "public"."activities" to "service_role";

grant update on table "public"."activities" to "service_role";

grant delete on table "public"."activity_streams" to "anon";

grant insert on table "public"."activity_streams" to "anon";

grant references on table "public"."activity_streams" to "anon";

grant select on table "public"."activity_streams" to "anon";

grant trigger on table "public"."activity_streams" to "anon";

grant truncate on table "public"."activity_streams" to "anon";

grant update on table "public"."activity_streams" to "anon";

grant delete on table "public"."activity_streams" to "authenticated";

grant insert on table "public"."activity_streams" to "authenticated";

grant references on table "public"."activity_streams" to "authenticated";

grant select on table "public"."activity_streams" to "authenticated";

grant trigger on table "public"."activity_streams" to "authenticated";

grant truncate on table "public"."activity_streams" to "authenticated";

grant update on table "public"."activity_streams" to "authenticated";

grant delete on table "public"."activity_streams" to "service_role";

grant insert on table "public"."activity_streams" to "service_role";

grant references on table "public"."activity_streams" to "service_role";

grant select on table "public"."activity_streams" to "service_role";

grant trigger on table "public"."activity_streams" to "service_role";

grant truncate on table "public"."activity_streams" to "service_role";

grant update on table "public"."activity_streams" to "service_role";

grant delete on table "public"."athlete_constraints" to "anon";

grant insert on table "public"."athlete_constraints" to "anon";

grant references on table "public"."athlete_constraints" to "anon";

grant select on table "public"."athlete_constraints" to "anon";

grant trigger on table "public"."athlete_constraints" to "anon";

grant truncate on table "public"."athlete_constraints" to "anon";

grant update on table "public"."athlete_constraints" to "anon";

grant delete on table "public"."athlete_constraints" to "authenticated";

grant insert on table "public"."athlete_constraints" to "authenticated";

grant references on table "public"."athlete_constraints" to "authenticated";

grant select on table "public"."athlete_constraints" to "authenticated";

grant trigger on table "public"."athlete_constraints" to "authenticated";

grant truncate on table "public"."athlete_constraints" to "authenticated";

grant update on table "public"."athlete_constraints" to "authenticated";

grant delete on table "public"."athlete_constraints" to "service_role";

grant insert on table "public"."athlete_constraints" to "service_role";

grant references on table "public"."athlete_constraints" to "service_role";

grant select on table "public"."athlete_constraints" to "service_role";

grant trigger on table "public"."athlete_constraints" to "service_role";

grant truncate on table "public"."athlete_constraints" to "service_role";

grant update on table "public"."athlete_constraints" to "service_role";

grant delete on table "public"."athlete_goals" to "anon";

grant insert on table "public"."athlete_goals" to "anon";

grant references on table "public"."athlete_goals" to "anon";

grant select on table "public"."athlete_goals" to "anon";

grant trigger on table "public"."athlete_goals" to "anon";

grant truncate on table "public"."athlete_goals" to "anon";

grant update on table "public"."athlete_goals" to "anon";

grant delete on table "public"."athlete_goals" to "authenticated";

grant insert on table "public"."athlete_goals" to "authenticated";

grant references on table "public"."athlete_goals" to "authenticated";

grant select on table "public"."athlete_goals" to "authenticated";

grant trigger on table "public"."athlete_goals" to "authenticated";

grant truncate on table "public"."athlete_goals" to "authenticated";

grant update on table "public"."athlete_goals" to "authenticated";

grant delete on table "public"."athlete_goals" to "service_role";

grant insert on table "public"."athlete_goals" to "service_role";

grant references on table "public"."athlete_goals" to "service_role";

grant select on table "public"."athlete_goals" to "service_role";

grant trigger on table "public"."athlete_goals" to "service_role";

grant truncate on table "public"."athlete_goals" to "service_role";

grant update on table "public"."athlete_goals" to "service_role";

grant delete on table "public"."athlete_integrations" to "anon";

grant insert on table "public"."athlete_integrations" to "anon";

grant references on table "public"."athlete_integrations" to "anon";

grant select on table "public"."athlete_integrations" to "anon";

grant trigger on table "public"."athlete_integrations" to "anon";

grant truncate on table "public"."athlete_integrations" to "anon";

grant update on table "public"."athlete_integrations" to "anon";

grant delete on table "public"."athlete_integrations" to "authenticated";

grant insert on table "public"."athlete_integrations" to "authenticated";

grant references on table "public"."athlete_integrations" to "authenticated";

grant select on table "public"."athlete_integrations" to "authenticated";

grant trigger on table "public"."athlete_integrations" to "authenticated";

grant truncate on table "public"."athlete_integrations" to "authenticated";

grant update on table "public"."athlete_integrations" to "authenticated";

grant delete on table "public"."athlete_integrations" to "service_role";

grant insert on table "public"."athlete_integrations" to "service_role";

grant references on table "public"."athlete_integrations" to "service_role";

grant select on table "public"."athlete_integrations" to "service_role";

grant trigger on table "public"."athlete_integrations" to "service_role";

grant truncate on table "public"."athlete_integrations" to "service_role";

grant update on table "public"."athlete_integrations" to "service_role";

grant delete on table "public"."athletes" to "anon";

grant insert on table "public"."athletes" to "anon";

grant references on table "public"."athletes" to "anon";

grant select on table "public"."athletes" to "anon";

grant trigger on table "public"."athletes" to "anon";

grant truncate on table "public"."athletes" to "anon";

grant update on table "public"."athletes" to "anon";

grant delete on table "public"."athletes" to "authenticated";

grant insert on table "public"."athletes" to "authenticated";

grant references on table "public"."athletes" to "authenticated";

grant select on table "public"."athletes" to "authenticated";

grant trigger on table "public"."athletes" to "authenticated";

grant truncate on table "public"."athletes" to "authenticated";

grant update on table "public"."athletes" to "authenticated";

grant delete on table "public"."athletes" to "service_role";

grant insert on table "public"."athletes" to "service_role";

grant references on table "public"."athletes" to "service_role";

grant select on table "public"."athletes" to "service_role";

grant trigger on table "public"."athletes" to "service_role";

grant truncate on table "public"."athletes" to "service_role";

grant update on table "public"."athletes" to "service_role";

grant delete on table "public"."chat_messages" to "anon";

grant insert on table "public"."chat_messages" to "anon";

grant references on table "public"."chat_messages" to "anon";

grant select on table "public"."chat_messages" to "anon";

grant trigger on table "public"."chat_messages" to "anon";

grant truncate on table "public"."chat_messages" to "anon";

grant update on table "public"."chat_messages" to "anon";

grant delete on table "public"."chat_messages" to "authenticated";

grant insert on table "public"."chat_messages" to "authenticated";

grant references on table "public"."chat_messages" to "authenticated";

grant select on table "public"."chat_messages" to "authenticated";

grant trigger on table "public"."chat_messages" to "authenticated";

grant truncate on table "public"."chat_messages" to "authenticated";

grant update on table "public"."chat_messages" to "authenticated";

grant delete on table "public"."chat_messages" to "service_role";

grant insert on table "public"."chat_messages" to "service_role";

grant references on table "public"."chat_messages" to "service_role";

grant select on table "public"."chat_messages" to "service_role";

grant trigger on table "public"."chat_messages" to "service_role";

grant truncate on table "public"."chat_messages" to "service_role";

grant update on table "public"."chat_messages" to "service_role";

grant delete on table "public"."chat_sessions" to "anon";

grant insert on table "public"."chat_sessions" to "anon";

grant references on table "public"."chat_sessions" to "anon";

grant select on table "public"."chat_sessions" to "anon";

grant trigger on table "public"."chat_sessions" to "anon";

grant truncate on table "public"."chat_sessions" to "anon";

grant update on table "public"."chat_sessions" to "anon";

grant delete on table "public"."chat_sessions" to "authenticated";

grant insert on table "public"."chat_sessions" to "authenticated";

grant references on table "public"."chat_sessions" to "authenticated";

grant select on table "public"."chat_sessions" to "authenticated";

grant trigger on table "public"."chat_sessions" to "authenticated";

grant truncate on table "public"."chat_sessions" to "authenticated";

grant update on table "public"."chat_sessions" to "authenticated";

grant delete on table "public"."chat_sessions" to "service_role";

grant insert on table "public"."chat_sessions" to "service_role";

grant references on table "public"."chat_sessions" to "service_role";

grant select on table "public"."chat_sessions" to "service_role";

grant trigger on table "public"."chat_sessions" to "service_role";

grant truncate on table "public"."chat_sessions" to "service_role";

grant update on table "public"."chat_sessions" to "service_role";

grant delete on table "public"."health_metrics" to "anon";

grant insert on table "public"."health_metrics" to "anon";

grant references on table "public"."health_metrics" to "anon";

grant select on table "public"."health_metrics" to "anon";

grant trigger on table "public"."health_metrics" to "anon";

grant truncate on table "public"."health_metrics" to "anon";

grant update on table "public"."health_metrics" to "anon";

grant delete on table "public"."health_metrics" to "authenticated";

grant insert on table "public"."health_metrics" to "authenticated";

grant references on table "public"."health_metrics" to "authenticated";

grant select on table "public"."health_metrics" to "authenticated";

grant trigger on table "public"."health_metrics" to "authenticated";

grant truncate on table "public"."health_metrics" to "authenticated";

grant update on table "public"."health_metrics" to "authenticated";

grant delete on table "public"."health_metrics" to "service_role";

grant insert on table "public"."health_metrics" to "service_role";

grant references on table "public"."health_metrics" to "service_role";

grant select on table "public"."health_metrics" to "service_role";

grant trigger on table "public"."health_metrics" to "service_role";

grant truncate on table "public"."health_metrics" to "service_role";

grant update on table "public"."health_metrics" to "service_role";

grant delete on table "public"."laps" to "anon";

grant insert on table "public"."laps" to "anon";

grant references on table "public"."laps" to "anon";

grant select on table "public"."laps" to "anon";

grant trigger on table "public"."laps" to "anon";

grant truncate on table "public"."laps" to "anon";

grant update on table "public"."laps" to "anon";

grant delete on table "public"."laps" to "authenticated";

grant insert on table "public"."laps" to "authenticated";

grant references on table "public"."laps" to "authenticated";

grant select on table "public"."laps" to "authenticated";

grant trigger on table "public"."laps" to "authenticated";

grant truncate on table "public"."laps" to "authenticated";

grant update on table "public"."laps" to "authenticated";

grant delete on table "public"."laps" to "service_role";

grant insert on table "public"."laps" to "service_role";

grant references on table "public"."laps" to "service_role";

grant select on table "public"."laps" to "service_role";

grant trigger on table "public"."laps" to "service_role";

grant truncate on table "public"."laps" to "service_role";

grant update on table "public"."laps" to "service_role";

grant delete on table "public"."phase_progress" to "anon";

grant insert on table "public"."phase_progress" to "anon";

grant references on table "public"."phase_progress" to "anon";

grant select on table "public"."phase_progress" to "anon";

grant trigger on table "public"."phase_progress" to "anon";

grant truncate on table "public"."phase_progress" to "anon";

grant update on table "public"."phase_progress" to "anon";

grant delete on table "public"."phase_progress" to "authenticated";

grant insert on table "public"."phase_progress" to "authenticated";

grant references on table "public"."phase_progress" to "authenticated";

grant select on table "public"."phase_progress" to "authenticated";

grant trigger on table "public"."phase_progress" to "authenticated";

grant truncate on table "public"."phase_progress" to "authenticated";

grant update on table "public"."phase_progress" to "authenticated";

grant delete on table "public"."phase_progress" to "service_role";

grant insert on table "public"."phase_progress" to "service_role";

grant references on table "public"."phase_progress" to "service_role";

grant select on table "public"."phase_progress" to "service_role";

grant trigger on table "public"."phase_progress" to "service_role";

grant truncate on table "public"."phase_progress" to "service_role";

grant update on table "public"."phase_progress" to "service_role";

grant delete on table "public"."plan_adjustments" to "anon";

grant insert on table "public"."plan_adjustments" to "anon";

grant references on table "public"."plan_adjustments" to "anon";

grant select on table "public"."plan_adjustments" to "anon";

grant trigger on table "public"."plan_adjustments" to "anon";

grant truncate on table "public"."plan_adjustments" to "anon";

grant update on table "public"."plan_adjustments" to "anon";

grant delete on table "public"."plan_adjustments" to "authenticated";

grant insert on table "public"."plan_adjustments" to "authenticated";

grant references on table "public"."plan_adjustments" to "authenticated";

grant select on table "public"."plan_adjustments" to "authenticated";

grant trigger on table "public"."plan_adjustments" to "authenticated";

grant truncate on table "public"."plan_adjustments" to "authenticated";

grant update on table "public"."plan_adjustments" to "authenticated";

grant delete on table "public"."plan_adjustments" to "service_role";

grant insert on table "public"."plan_adjustments" to "service_role";

grant references on table "public"."plan_adjustments" to "service_role";

grant select on table "public"."plan_adjustments" to "service_role";

grant trigger on table "public"."plan_adjustments" to "service_role";

grant truncate on table "public"."plan_adjustments" to "service_role";

grant update on table "public"."plan_adjustments" to "service_role";

grant delete on table "public"."planned_workouts" to "anon";

grant insert on table "public"."planned_workouts" to "anon";

grant references on table "public"."planned_workouts" to "anon";

grant select on table "public"."planned_workouts" to "anon";

grant trigger on table "public"."planned_workouts" to "anon";

grant truncate on table "public"."planned_workouts" to "anon";

grant update on table "public"."planned_workouts" to "anon";

grant delete on table "public"."planned_workouts" to "authenticated";

grant insert on table "public"."planned_workouts" to "authenticated";

grant references on table "public"."planned_workouts" to "authenticated";

grant select on table "public"."planned_workouts" to "authenticated";

grant trigger on table "public"."planned_workouts" to "authenticated";

grant truncate on table "public"."planned_workouts" to "authenticated";

grant update on table "public"."planned_workouts" to "authenticated";

grant delete on table "public"."planned_workouts" to "service_role";

grant insert on table "public"."planned_workouts" to "service_role";

grant references on table "public"."planned_workouts" to "service_role";

grant select on table "public"."planned_workouts" to "service_role";

grant trigger on table "public"."planned_workouts" to "service_role";

grant truncate on table "public"."planned_workouts" to "service_role";

grant update on table "public"."planned_workouts" to "service_role";

grant delete on table "public"."sync_log" to "anon";

grant insert on table "public"."sync_log" to "anon";

grant references on table "public"."sync_log" to "anon";

grant select on table "public"."sync_log" to "anon";

grant trigger on table "public"."sync_log" to "anon";

grant truncate on table "public"."sync_log" to "anon";

grant update on table "public"."sync_log" to "anon";

grant delete on table "public"."sync_log" to "authenticated";

grant insert on table "public"."sync_log" to "authenticated";

grant references on table "public"."sync_log" to "authenticated";

grant select on table "public"."sync_log" to "authenticated";

grant trigger on table "public"."sync_log" to "authenticated";

grant truncate on table "public"."sync_log" to "authenticated";

grant update on table "public"."sync_log" to "authenticated";

grant delete on table "public"."sync_log" to "service_role";

grant insert on table "public"."sync_log" to "service_role";

grant references on table "public"."sync_log" to "service_role";

grant select on table "public"."sync_log" to "service_role";

grant trigger on table "public"."sync_log" to "service_role";

grant truncate on table "public"."sync_log" to "service_role";

grant update on table "public"."sync_log" to "service_role";

grant delete on table "public"."training_phases" to "anon";

grant insert on table "public"."training_phases" to "anon";

grant references on table "public"."training_phases" to "anon";

grant select on table "public"."training_phases" to "anon";

grant trigger on table "public"."training_phases" to "anon";

grant truncate on table "public"."training_phases" to "anon";

grant update on table "public"."training_phases" to "anon";

grant delete on table "public"."training_phases" to "authenticated";

grant insert on table "public"."training_phases" to "authenticated";

grant references on table "public"."training_phases" to "authenticated";

grant select on table "public"."training_phases" to "authenticated";

grant trigger on table "public"."training_phases" to "authenticated";

grant truncate on table "public"."training_phases" to "authenticated";

grant update on table "public"."training_phases" to "authenticated";

grant delete on table "public"."training_phases" to "service_role";

grant insert on table "public"."training_phases" to "service_role";

grant references on table "public"."training_phases" to "service_role";

grant select on table "public"."training_phases" to "service_role";

grant trigger on table "public"."training_phases" to "service_role";

grant truncate on table "public"."training_phases" to "service_role";

grant update on table "public"."training_phases" to "service_role";

grant delete on table "public"."training_plans" to "anon";

grant insert on table "public"."training_plans" to "anon";

grant references on table "public"."training_plans" to "anon";

grant select on table "public"."training_plans" to "anon";

grant trigger on table "public"."training_plans" to "anon";

grant truncate on table "public"."training_plans" to "anon";

grant update on table "public"."training_plans" to "anon";

grant delete on table "public"."training_plans" to "authenticated";

grant insert on table "public"."training_plans" to "authenticated";

grant references on table "public"."training_plans" to "authenticated";

grant select on table "public"."training_plans" to "authenticated";

grant trigger on table "public"."training_plans" to "authenticated";

grant truncate on table "public"."training_plans" to "authenticated";

grant update on table "public"."training_plans" to "authenticated";

grant delete on table "public"."training_plans" to "service_role";

grant insert on table "public"."training_plans" to "service_role";

grant references on table "public"."training_plans" to "service_role";

grant select on table "public"."training_plans" to "service_role";

grant trigger on table "public"."training_plans" to "service_role";

grant truncate on table "public"."training_plans" to "service_role";

grant update on table "public"."training_plans" to "service_role";

grant delete on table "public"."weekly_plans" to "anon";

grant insert on table "public"."weekly_plans" to "anon";

grant references on table "public"."weekly_plans" to "anon";

grant select on table "public"."weekly_plans" to "anon";

grant trigger on table "public"."weekly_plans" to "anon";

grant truncate on table "public"."weekly_plans" to "anon";

grant update on table "public"."weekly_plans" to "anon";

grant delete on table "public"."weekly_plans" to "authenticated";

grant insert on table "public"."weekly_plans" to "authenticated";

grant references on table "public"."weekly_plans" to "authenticated";

grant select on table "public"."weekly_plans" to "authenticated";

grant trigger on table "public"."weekly_plans" to "authenticated";

grant truncate on table "public"."weekly_plans" to "authenticated";

grant update on table "public"."weekly_plans" to "authenticated";

grant delete on table "public"."weekly_plans" to "service_role";

grant insert on table "public"."weekly_plans" to "service_role";

grant references on table "public"."weekly_plans" to "service_role";

grant select on table "public"."weekly_plans" to "service_role";

grant trigger on table "public"."weekly_plans" to "service_role";

grant truncate on table "public"."weekly_plans" to "service_role";

grant update on table "public"."weekly_plans" to "service_role";

grant delete on table "public"."workout_feedback" to "anon";

grant insert on table "public"."workout_feedback" to "anon";

grant references on table "public"."workout_feedback" to "anon";

grant select on table "public"."workout_feedback" to "anon";

grant trigger on table "public"."workout_feedback" to "anon";

grant truncate on table "public"."workout_feedback" to "anon";

grant update on table "public"."workout_feedback" to "anon";

grant delete on table "public"."workout_feedback" to "authenticated";

grant insert on table "public"."workout_feedback" to "authenticated";

grant references on table "public"."workout_feedback" to "authenticated";

grant select on table "public"."workout_feedback" to "authenticated";

grant trigger on table "public"."workout_feedback" to "authenticated";

grant truncate on table "public"."workout_feedback" to "authenticated";

grant update on table "public"."workout_feedback" to "authenticated";

grant delete on table "public"."workout_feedback" to "service_role";

grant insert on table "public"."workout_feedback" to "service_role";

grant references on table "public"."workout_feedback" to "service_role";

grant select on table "public"."workout_feedback" to "service_role";

grant trigger on table "public"."workout_feedback" to "service_role";

grant truncate on table "public"."workout_feedback" to "service_role";

grant update on table "public"."workout_feedback" to "service_role";

grant delete on table "public"."workout_flags" to "anon";

grant insert on table "public"."workout_flags" to "anon";

grant references on table "public"."workout_flags" to "anon";

grant select on table "public"."workout_flags" to "anon";

grant trigger on table "public"."workout_flags" to "anon";

grant truncate on table "public"."workout_flags" to "anon";

grant update on table "public"."workout_flags" to "anon";

grant delete on table "public"."workout_flags" to "authenticated";

grant insert on table "public"."workout_flags" to "authenticated";

grant references on table "public"."workout_flags" to "authenticated";

grant select on table "public"."workout_flags" to "authenticated";

grant trigger on table "public"."workout_flags" to "authenticated";

grant truncate on table "public"."workout_flags" to "authenticated";

grant update on table "public"."workout_flags" to "authenticated";

grant delete on table "public"."workout_flags" to "service_role";

grant insert on table "public"."workout_flags" to "service_role";

grant references on table "public"."workout_flags" to "service_role";

grant select on table "public"."workout_flags" to "service_role";

grant trigger on table "public"."workout_flags" to "service_role";

grant truncate on table "public"."workout_flags" to "service_role";

grant update on table "public"."workout_flags" to "service_role";


  create policy "Users can delete own activities"
  on "public"."activities"
  as permissive
  for delete
  to public
using (public.is_own_athlete(athlete_id));



  create policy "Users can insert own activities"
  on "public"."activities"
  as permissive
  for insert
  to public
with check (public.is_own_athlete(athlete_id));



  create policy "Users can update own activities"
  on "public"."activities"
  as permissive
  for update
  to public
using (public.is_own_athlete(athlete_id));



  create policy "Users can view own activities"
  on "public"."activities"
  as permissive
  for select
  to authenticated
using ((athlete_id = ( SELECT auth.uid() AS uid)));



  create policy "Users can insert own activity streams"
  on "public"."activity_streams"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.activities
  WHERE ((activities.id = activity_streams.activity_id) AND public.is_own_athlete(activities.athlete_id)))));



  create policy "Users can view own activity streams"
  on "public"."activity_streams"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.activities
  WHERE ((activities.id = activity_streams.activity_id) AND public.is_own_athlete(activities.athlete_id)))));



  create policy "Users can delete own constraints"
  on "public"."athlete_constraints"
  as permissive
  for delete
  to public
using (public.is_own_athlete(athlete_id));



  create policy "Users can insert own constraints"
  on "public"."athlete_constraints"
  as permissive
  for insert
  to public
with check (public.is_own_athlete(athlete_id));



  create policy "Users can update own constraints"
  on "public"."athlete_constraints"
  as permissive
  for update
  to public
using (public.is_own_athlete(athlete_id));



  create policy "Users can view own constraints"
  on "public"."athlete_constraints"
  as permissive
  for select
  to public
using (public.is_own_athlete(athlete_id));



  create policy "Users can delete own goals"
  on "public"."athlete_goals"
  as permissive
  for delete
  to public
using (public.is_own_athlete(athlete_id));



  create policy "Users can insert own goals"
  on "public"."athlete_goals"
  as permissive
  for insert
  to public
with check (public.is_own_athlete(athlete_id));



  create policy "Users can update own goals"
  on "public"."athlete_goals"
  as permissive
  for update
  to public
using (public.is_own_athlete(athlete_id));



  create policy "Users can view own goals"
  on "public"."athlete_goals"
  as permissive
  for select
  to public
using (public.is_own_athlete(athlete_id));



  create policy "Users can delete own integrations"
  on "public"."athlete_integrations"
  as permissive
  for delete
  to public
using (public.is_own_athlete(athlete_id));



  create policy "Users can insert own integrations"
  on "public"."athlete_integrations"
  as permissive
  for insert
  to public
with check (public.is_own_athlete(athlete_id));



  create policy "Users can update own integrations"
  on "public"."athlete_integrations"
  as permissive
  for update
  to public
using (public.is_own_athlete(athlete_id));



  create policy "Users can view own integrations"
  on "public"."athlete_integrations"
  as permissive
  for select
  to public
using (public.is_own_athlete(athlete_id));



  create policy "athletes_delete_policy"
  on "public"."athletes"
  as permissive
  for delete
  to authenticated
using ((id = ( SELECT auth.uid() AS uid)));



  create policy "athletes_insert_policy"
  on "public"."athletes"
  as permissive
  for insert
  to authenticated
with check ((id = ( SELECT auth.uid() AS uid)));



  create policy "athletes_select_policy"
  on "public"."athletes"
  as permissive
  for select
  to authenticated
using ((id = ( SELECT auth.uid() AS uid)));



  create policy "athletes_update_policy"
  on "public"."athletes"
  as permissive
  for update
  to authenticated
using ((id = ( SELECT auth.uid() AS uid)))
with check ((id = ( SELECT auth.uid() AS uid)));



  create policy "Users can insert own chat messages"
  on "public"."chat_messages"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.chat_sessions
  WHERE ((chat_sessions.id = chat_messages.session_id) AND public.is_own_athlete(chat_sessions.athlete_id)))));



  create policy "Users can view own chat messages"
  on "public"."chat_messages"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.chat_sessions
  WHERE ((chat_sessions.id = chat_messages.session_id) AND public.is_own_athlete(chat_sessions.athlete_id)))));



  create policy "Users can insert own chat sessions"
  on "public"."chat_sessions"
  as permissive
  for insert
  to public
with check (public.is_own_athlete(athlete_id));



  create policy "Users can update own chat sessions"
  on "public"."chat_sessions"
  as permissive
  for update
  to public
using (public.is_own_athlete(athlete_id));



  create policy "Users can view own chat sessions"
  on "public"."chat_sessions"
  as permissive
  for select
  to public
using (public.is_own_athlete(athlete_id));



  create policy "Users can insert own health metrics"
  on "public"."health_metrics"
  as permissive
  for insert
  to public
with check (public.is_own_athlete(athlete_id));



  create policy "Users can update own health metrics"
  on "public"."health_metrics"
  as permissive
  for update
  to public
using (public.is_own_athlete(athlete_id));



  create policy "Users can view own health metrics"
  on "public"."health_metrics"
  as permissive
  for select
  to public
using (public.is_own_athlete(athlete_id));



  create policy "Users can insert own laps"
  on "public"."laps"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.activities
  WHERE ((activities.id = laps.activity_id) AND public.is_own_athlete(activities.athlete_id)))));



  create policy "Users can update own laps"
  on "public"."laps"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.activities
  WHERE ((activities.id = laps.activity_id) AND public.is_own_athlete(activities.athlete_id)))));



  create policy "Users can view own laps"
  on "public"."laps"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.activities
  WHERE ((activities.id = laps.activity_id) AND public.is_own_athlete(activities.athlete_id)))));



  create policy "Users can insert own phase progress"
  on "public"."phase_progress"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM (public.training_phases
     JOIN public.training_plans ON ((training_plans.id = training_phases.plan_id)))
  WHERE ((training_phases.id = phase_progress.phase_id) AND public.is_own_athlete(training_plans.athlete_id)))));



  create policy "Users can view own phase progress"
  on "public"."phase_progress"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM (public.training_phases
     JOIN public.training_plans ON ((training_plans.id = training_phases.plan_id)))
  WHERE ((training_phases.id = phase_progress.phase_id) AND public.is_own_athlete(training_plans.athlete_id)))));



  create policy "Users can insert own adjustments"
  on "public"."plan_adjustments"
  as permissive
  for insert
  to public
with check (public.is_own_athlete(athlete_id));



  create policy "Users can view own adjustments"
  on "public"."plan_adjustments"
  as permissive
  for select
  to public
using (public.is_own_athlete(athlete_id));



  create policy "Users can delete own planned workouts"
  on "public"."planned_workouts"
  as permissive
  for delete
  to public
using (public.is_own_athlete(athlete_id));



  create policy "Users can insert own planned workouts"
  on "public"."planned_workouts"
  as permissive
  for insert
  to public
with check (public.is_own_athlete(athlete_id));



  create policy "Users can update own planned workouts"
  on "public"."planned_workouts"
  as permissive
  for update
  to public
using (public.is_own_athlete(athlete_id));



  create policy "Users can view own planned workouts"
  on "public"."planned_workouts"
  as permissive
  for select
  to authenticated
using ((athlete_id = ( SELECT auth.uid() AS uid)));



  create policy "Users can insert own sync logs"
  on "public"."sync_log"
  as permissive
  for insert
  to public
with check (public.is_own_athlete(athlete_id));



  create policy "Users can view own sync logs"
  on "public"."sync_log"
  as permissive
  for select
  to public
using (public.is_own_athlete(athlete_id));



  create policy "Users can delete own phases"
  on "public"."training_phases"
  as permissive
  for delete
  to public
using ((EXISTS ( SELECT 1
   FROM public.training_plans
  WHERE ((training_plans.id = training_phases.plan_id) AND public.is_own_athlete(training_plans.athlete_id)))));



  create policy "Users can insert own phases"
  on "public"."training_phases"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.training_plans
  WHERE ((training_plans.id = training_phases.plan_id) AND public.is_own_athlete(training_plans.athlete_id)))));



  create policy "Users can update own phases"
  on "public"."training_phases"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.training_plans
  WHERE ((training_plans.id = training_phases.plan_id) AND public.is_own_athlete(training_plans.athlete_id)))));



  create policy "Users can view own phases"
  on "public"."training_phases"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.training_plans
  WHERE ((training_plans.id = training_phases.plan_id) AND public.is_own_athlete(training_plans.athlete_id)))));



  create policy "training_plans_delete_policy"
  on "public"."training_plans"
  as permissive
  for delete
  to authenticated
using ((athlete_id = ( SELECT auth.uid() AS uid)));



  create policy "training_plans_insert_policy"
  on "public"."training_plans"
  as permissive
  for insert
  to authenticated
with check ((athlete_id = ( SELECT auth.uid() AS uid)));



  create policy "training_plans_select_policy"
  on "public"."training_plans"
  as permissive
  for select
  to authenticated
using ((athlete_id = ( SELECT auth.uid() AS uid)));



  create policy "training_plans_update_policy"
  on "public"."training_plans"
  as permissive
  for update
  to authenticated
using ((athlete_id = ( SELECT auth.uid() AS uid)))
with check ((athlete_id = ( SELECT auth.uid() AS uid)));



  create policy "Users can delete own weekly plans"
  on "public"."weekly_plans"
  as permissive
  for delete
  to public
using (public.is_own_athlete(athlete_id));



  create policy "Users can insert own weekly plans"
  on "public"."weekly_plans"
  as permissive
  for insert
  to public
with check (public.is_own_athlete(athlete_id));



  create policy "Users can update own weekly plans"
  on "public"."weekly_plans"
  as permissive
  for update
  to public
using (public.is_own_athlete(athlete_id));



  create policy "Users can view own weekly plans"
  on "public"."weekly_plans"
  as permissive
  for select
  to public
using (public.is_own_athlete(athlete_id));



  create policy "Users can insert own feedback"
  on "public"."workout_feedback"
  as permissive
  for insert
  to public
with check (public.is_own_athlete(athlete_id));



  create policy "Users can update own feedback"
  on "public"."workout_feedback"
  as permissive
  for update
  to public
using (public.is_own_athlete(athlete_id));



  create policy "Users can view own feedback"
  on "public"."workout_feedback"
  as permissive
  for select
  to public
using (public.is_own_athlete(athlete_id));



  create policy "Users can insert own workout flags"
  on "public"."workout_flags"
  as permissive
  for insert
  to public
with check ((((planned_workout_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.planned_workouts
  WHERE ((planned_workouts.id = workout_flags.planned_workout_id) AND public.is_own_athlete(planned_workouts.athlete_id))))) OR ((activity_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.activities
  WHERE ((activities.id = workout_flags.activity_id) AND public.is_own_athlete(activities.athlete_id)))))));



  create policy "Users can update own workout flags"
  on "public"."workout_flags"
  as permissive
  for update
  to public
using ((((planned_workout_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.planned_workouts
  WHERE ((planned_workouts.id = workout_flags.planned_workout_id) AND public.is_own_athlete(planned_workouts.athlete_id))))) OR ((activity_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.activities
  WHERE ((activities.id = workout_flags.activity_id) AND public.is_own_athlete(activities.athlete_id)))))));



  create policy "Users can view own workout flags"
  on "public"."workout_flags"
  as permissive
  for select
  to public
using ((((planned_workout_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.planned_workouts
  WHERE ((planned_workouts.id = workout_flags.planned_workout_id) AND public.is_own_athlete(planned_workouts.athlete_id))))) OR ((activity_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.activities
  WHERE ((activities.id = workout_flags.activity_id) AND public.is_own_athlete(activities.athlete_id)))))));



