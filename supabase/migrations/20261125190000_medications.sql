-- Faz 2: Ilac / takviye / vitamin takibi

create table if not exists public.medications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  dose text,
  kind text not null default 'supplement' check (kind in ('medication','supplement','vitamin')),
  times text[] not null default array['08:00'],
  notes text,
  start_date date not null default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.medication_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  medication_id uuid not null references public.medications(id) on delete cascade,
  log_date date not null,
  time_slot text not null,
  taken_at timestamptz not null default now(),
  unique (medication_id, log_date, time_slot)
);

create index if not exists medications_user_idx on public.medications (user_id, active);
create index if not exists medication_logs_user_date_idx on public.medication_logs (user_id, log_date desc);

alter table public.medications enable row level security;
alter table public.medication_logs enable row level security;

drop policy if exists medications_owner_all on public.medications;
create policy medications_owner_all on public.medications
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists medication_logs_owner_all on public.medication_logs;
create policy medication_logs_owner_all on public.medication_logs
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
