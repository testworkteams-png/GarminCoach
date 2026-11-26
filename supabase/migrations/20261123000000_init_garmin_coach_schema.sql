-- GarminCoach PostgreSQL Schema & Seed Migration
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1. Athlete Settings & Physiological Baseline (Single Row Config)
create table if not exists public.athlete_settings (
  id int primary key default 1 check (id = 1),
  birth_year int not null default 1988,
  timezone text not null default 'Europe/Istanbul',
  manual_city_override text default null,
  default_city text not null default 'Ümraniye',
  default_lat double precision not null default 41.0256,
  default_lon double precision not null default 29.0963,
  active_city text not null default 'Ümraniye',
  active_lat double precision not null default 41.0256,
  active_lon double precision not null default 29.0963,
  location_source text not null default 'DEFAULT' check (location_source in ('MANUAL', 'GPS_ACTIVITY', 'DEFAULT')),
  base_rhr int not null default 46,
  rhr_warn_threshold int not null default 51,
  rhr_extreme_threshold int not null default 55,
  base_hrv_min int not null default 59,
  base_hrv_max int not null default 74,
  hrv_warn_threshold int not null default 48,
  hrv_extreme_threshold int not null default 40,
  resp_warn_threshold numeric(4,1) not null default 18.0,
  sleep_stress_threshold int not null default 23,
  skin_temp_deviation_threshold numeric(3,1) not null default 0.4,
  spo2_warn_threshold int not null default 91,
  spo2_extreme_threshold int not null default 87,
  weekly_routine jsonb not null default '{
    "cardio": "Düzenli 5-6 km açık hava yürüyüş/koşu",
    "strength_days": ["Pazartesi", "Salı", "Cuma"],
    "strength_equipment": "Evde 2-8 kg dambıl (varsayılan 6 kg, 4x15 set)",
    "target_muscles": ["Göğüs", "Omuz", "Sırt", "Ön Kol", "Core"]
  }'::jsonb,
  last_daily_report_date date,
  pending_hrv_report_date date,
  last_red_alert_date date,
  weather_cache jsonb,
  updated_at timestamptz not null default now()
);

-- 2. Daily Biometrics (Unlimited Archive + 30-Day Rolling Window View)
create table if not exists public.daily_biometrics (
  log_date date primary key,
  readiness_score int,
  readiness_status text check (readiness_status in ('OPTIMAL', 'MODERATE', 'LOW', 'CRITICAL')),
  body_battery_max int,
  body_battery_min int,
  body_battery_charged int,
  body_battery_drained int,
  sleep_score int,
  sleep_seconds int,
  deep_sleep_seconds int,
  light_sleep_seconds int,
  rem_sleep_seconds int,
  awake_seconds int,
  sleep_stress_avg numeric(4,1),
  sleep_respiration_avg numeric(4,1),
  skin_temp_deviation numeric(4,2),
  hrv_nightly_avg int,
  hrv_weekly_avg int,
  hrv_status text,
  rhr int,
  min_hr int,
  max_hr int,
  stress_avg int,
  spo2_avg numeric(4,1),
  spo2_min int,
  vo2_max numeric(4,1),
  fitness_age int,
  endurance_score int,
  steps int,
  active_kilocalories int,
  moderate_intensity_minutes int,
  vigorous_intensity_minutes int,
  evening_weather jsonb,
  red_flags jsonb not null default '[]'::jsonb,
  ai_daily_brief jsonb,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_daily_biometrics_log_date_desc
  on public.daily_biometrics (log_date desc);

-- 3. Activities (GPS Cardio + Dumbbell Strength Sets + Time Series)
create table if not exists public.activities (
  activity_id bigint primary key,
  activity_name text not null,
  activity_type text not null,
  start_time_local timestamptz not null,
  duration_seconds int,
  distance_meters numeric(10,2),
  calories int,
  avg_hr int,
  max_hr int,
  avg_speed numeric(6,3),
  avg_cadence int,
  elevation_gain numeric(7,2),
  aerobic_te numeric(3,1),
  anaerobic_te numeric(3,1),
  training_load numeric(6,1),
  start_lat double precision,
  start_lon double precision,
  location_name text,
  hr_zones jsonb,
  exercise_sets jsonb,
  muscle_heatmap jsonb,
  time_series jsonb,
  session_comparison jsonb,
  ai_post_workout_analysis jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_activities_start_time_desc
  on public.activities (start_time_local desc);
create index if not exists idx_activities_type
  on public.activities (activity_type);

-- 4. Weekly Executive Cockpit Strategies (Sunday Bulletin)
create table if not exists public.weekly_strategies (
  week_start_date date primary key,
  wow_deltas jsonb not null,
  zone_distribution jsonb not null,
  cardio_vs_strength jsonb not null,
  mvp_and_flags jsonb not null,
  weather_forecast_7d jsonb not null,
  weekly_schedule jsonb not null,
  ai_executive_summary text,
  created_at timestamptz not null default now()
);

create index if not exists idx_weekly_strategies_week_desc
  on public.weekly_strategies (week_start_date desc);

-- 5. Sync & Automation Logs
create table if not exists public.sync_logs (
  id bigint generated always as identity primary key,
  job_type text not null,
  status text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_sync_logs_created_desc
  on public.sync_logs (created_at desc);

-- 6. Morning Readiness Formula:
-- Body Battery Max (30%) + Sleep Score (30%) + Nightly HRV (25%) + RHR (15%)
create or replace function public.calculate_readiness_score(
  bb_max int,
  sleep_score int,
  hrv_avg int,
  rhr int
)
returns int
language plpgsql
immutable
set search_path = public
as $$
declare
  v_bb numeric := least(100, greatest(0, coalesce(bb_max, 0)));
  v_sleep numeric := least(100, greatest(0, coalesce(sleep_score, 0)));
  v_hrv numeric := 0;
  v_rhr numeric := 0;
  v_weight_sum numeric := 0;
  v_total numeric := 0;
begin
  if bb_max is not null then
    v_total := v_total + (v_bb * 0.30);
    v_weight_sum := v_weight_sum + 0.30;
  end if;

  if sleep_score is not null then
    v_total := v_total + (v_sleep * 0.30);
    v_weight_sum := v_weight_sum + 0.30;
  end if;

  if hrv_avg is not null then
    if hrv_avg >= 68 then
      v_hrv := 100;
    elsif hrv_avg >= 59 then
      v_hrv := 85 + ((hrv_avg - 59)::numeric / 9.0) * 15.0;
    elsif hrv_avg >= 48 then
      v_hrv := 60 + ((hrv_avg - 48)::numeric / 11.0) * 25.0;
    elsif hrv_avg >= 40 then
      v_hrv := 30 + ((hrv_avg - 40)::numeric / 8.0) * 30.0;
    else
      v_hrv := greatest(10, 30 - (40 - hrv_avg) * 2);
    end if;
    v_total := v_total + (v_hrv * 0.25);
    v_weight_sum := v_weight_sum + 0.25;
  end if;

  if rhr is not null then
    if rhr <= 46 then
      v_rhr := 100;
    elsif rhr <= 51 then
      v_rhr := 100 - ((rhr - 46)::numeric / 5.0) * 35.0;
    elsif rhr <= 55 then
      v_rhr := 65 - ((rhr - 51)::numeric / 4.0) * 35.0;
    else
      v_rhr := greatest(10, 30 - (rhr - 55) * 4);
    end if;
    v_total := v_total + (v_rhr * 0.15);
    v_weight_sum := v_weight_sum + 0.15;
  end if;

  if v_weight_sum = 0 then
    return 0;
  end if;

  return least(100, greatest(0, round(v_total / v_weight_sum)::int));
end;
$$;

-- 7. Row Level Security & Grants
grant usage on schema public to anon, authenticated, service_role;
grant select on public.athlete_settings, public.daily_biometrics, public.activities, public.weekly_strategies, public.sync_logs to anon, authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on function public.calculate_readiness_score(int, int, int, int) to anon, authenticated, service_role;

alter table public.athlete_settings enable row level security;
alter table public.daily_biometrics enable row level security;
alter table public.activities enable row level security;
alter table public.weekly_strategies enable row level security;
alter table public.sync_logs enable row level security;

create policy "read_athlete_settings"
  on public.athlete_settings for select
  to anon, authenticated
  using (id = 1);

create policy "read_daily_biometrics"
  on public.daily_biometrics for select
  to anon, authenticated
  using (log_date is not null);

create policy "read_activities"
  on public.activities for select
  to anon, authenticated
  using (activity_id > 0);

create policy "read_weekly_strategies"
  on public.weekly_strategies for select
  to anon, authenticated
  using (week_start_date is not null);

create policy "read_sync_logs"
  on public.sync_logs for select
  to anon, authenticated
  using (id > 0);
