-- 1. Drop legacy open anon read policies
drop policy if exists "read_athlete_settings" on public.athlete_settings;
drop policy if exists "read_daily_biometrics" on public.daily_biometrics;
drop policy if exists "read_activities" on public.activities;
drop policy if exists "read_weekly_strategies" on public.weekly_strategies;
drop policy if exists "read_sync_logs" on public.sync_logs;

-- 2. Alter athlete_settings for multi-user support
alter table public.athlete_settings drop constraint if exists athlete_settings_id_check;
create sequence if not exists public.athlete_settings_id_seq;
select setval('public.athlete_settings_id_seq', greatest(1, coalesce((select max(id) from public.athlete_settings), 1)));
alter table public.athlete_settings alter column id set default nextval('public.athlete_settings_id_seq');
alter table public.athlete_settings add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.athlete_settings add column if not exists display_name text;
create unique index if not exists idx_athlete_settings_user_id on public.athlete_settings (user_id) where user_id is not null;

-- 3. Add user_id & workout notification tracking to core tables
alter table public.daily_biometrics add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.activities add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.activities add column if not exists post_workout_notified_at timestamptz;
alter table public.weekly_strategies add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.sync_logs add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists idx_daily_biometrics_user_date on public.daily_biometrics (user_id, log_date desc);
create index if not exists idx_activities_user_start on public.activities (user_id, start_time_local desc);
create index if not exists idx_weekly_strategies_user_week on public.weekly_strategies (user_id, week_start_date desc);
create index if not exists idx_sync_logs_user_created on public.sync_logs (user_id, created_at desc);

-- Mark previously analyzed activities as already notified so historical activities are not re-alerted
update public.activities
set post_workout_notified_at = coalesce(created_at, now())
where post_workout_notified_at is null and ai_post_workout_analysis is not null;

-- 4. User Garmin/Gemini API Vault (server-managed only)
create table if not exists public.user_integrations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  garmin_api_base_url text not null default 'https://personal.connectapi.garmin.com',
  garmin_api_key text,
  gemini_api_key text,
  use_owner_default boolean not null default false,
  connection_status text not null default 'NOT_CONFIGURED' check (connection_status in ('NOT_CONFIGURED', 'CONNECTED', 'ERROR')),
  last_error text,
  last_tested_at timestamptz,
  updated_at timestamptz not null default now()
);

-- 5. FCM Push Tokens
create table if not exists public.user_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null default 'android' check (platform in ('android', 'ios', 'web')),
  fcm_token text not null,
  device_name text,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (user_id, fcm_token)
);
create index if not exists idx_user_push_tokens_user on public.user_push_tokens (user_id, enabled);

-- 6. Notification Inbox
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('MORNING_REPORT', 'WORKOUT_REPORT', 'WEEKLY_CEO', 'MONTHLY_CEO', 'HEALTH_ALERT')),
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  activity_id bigint,
  report_date date,
  read_at timestamptz,
  push_sent_at timestamptz,
  push_status text not null default 'IN_APP_ONLY' check (push_status in ('IN_APP_ONLY', 'SENT', 'FAILED')),
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user_created on public.notifications (user_id, created_at desc);
create index if not exists idx_notifications_user_unread on public.notifications (user_id) where read_at is null;

-- 7. Monthly CEO Reports
create table if not exists public.monthly_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month_key text not null,
  kpis jsonb not null,
  mom_deltas jsonb not null,
  ceo_brief jsonb not null,
  consistency_calendar jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, month_key)
);
create index if not exists idx_monthly_reports_user_month on public.monthly_reports (user_id, month_key desc);

-- 8. Enable RLS & Strict Per-User Policies
alter table public.user_integrations enable row level security;
alter table public.user_push_tokens enable row level security;
alter table public.notifications enable row level security;
alter table public.monthly_reports enable row level security;

revoke all on public.athlete_settings, public.daily_biometrics, public.activities, public.weekly_strategies, public.sync_logs, public.notifications, public.monthly_reports, public.user_push_tokens, public.user_integrations from anon;
revoke all on public.user_integrations from authenticated;

grant select, update on public.athlete_settings to authenticated;
grant select on public.daily_biometrics, public.activities, public.weekly_strategies, public.sync_logs, public.monthly_reports to authenticated;
grant select, update on public.notifications to authenticated;
grant select, insert, update, delete on public.user_push_tokens to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

create policy "user_integrations_block_clients" on public.user_integrations for all to anon, authenticated using (false) with check (false);

create policy "athlete_settings_own_select" on public.athlete_settings for select to authenticated using ((select auth.uid()) = user_id);
create policy "athlete_settings_own_update" on public.athlete_settings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "daily_biometrics_own_select" on public.daily_biometrics for select to authenticated using ((select auth.uid()) = user_id);
create policy "activities_own_select" on public.activities for select to authenticated using ((select auth.uid()) = user_id);
create policy "weekly_strategies_own_select" on public.weekly_strategies for select to authenticated using ((select auth.uid()) = user_id);
create policy "sync_logs_own_select" on public.sync_logs for select to authenticated using ((select auth.uid()) = user_id);
create policy "monthly_reports_own_select" on public.monthly_reports for select to authenticated using ((select auth.uid()) = user_id);

create policy "notifications_own_select" on public.notifications for select to authenticated using ((select auth.uid()) = user_id);
create policy "notifications_own_update" on public.notifications for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "push_tokens_own_all" on public.user_push_tokens for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 9. Update Cron schedules
select cron.unschedule('garmin_workout_check');
select cron.schedule(
  'garmin_workout_check',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://htooqswstuuzslvrgxsx.supabase.co/functions/v1/garmin-coach-engine',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"action":"yeniAntrenmanKontrol"}'::jsonb
  );
  $$
);
select cron.schedule(
  'garmin_monthly_ceo_report',
  '0 18 1 * *',
  $$
  select net.http_post(
    url := 'https://htooqswstuuzslvrgxsx.supabase.co/functions/v1/garmin-coach-engine',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"action":"aylikCeoRaporu"}'::jsonb
  );
  $$
);
