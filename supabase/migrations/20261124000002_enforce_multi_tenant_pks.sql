alter table public.athlete_settings alter column user_id set not null;
alter table public.daily_biometrics alter column user_id set not null;
alter table public.activities alter column user_id set not null;
alter table public.weekly_strategies alter column user_id set not null;
alter table public.sync_logs alter column user_id set not null;

alter table public.daily_biometrics drop constraint if exists daily_biometrics_pkey;
alter table public.daily_biometrics add primary key (user_id, log_date);

alter table public.activities drop constraint if exists activities_pkey;
alter table public.activities add primary key (user_id, activity_id);

alter table public.weekly_strategies drop constraint if exists weekly_strategies_pkey;
alter table public.weekly_strategies add primary key (user_id, week_start_date);
