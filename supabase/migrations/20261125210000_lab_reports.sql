-- Faz 2: Kan tahlili / laboratuvar takibi

create table if not exists public.lab_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  report_date date not null default current_date,
  lab_name text,
  notes text,
  source text not null default 'manual' check (source in ('manual','ai')),
  created_at timestamptz not null default now()
);

create table if not exists public.lab_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  report_id uuid not null references public.lab_reports(id) on delete cascade,
  test_name text not null,
  value numeric not null,
  unit text,
  ref_low numeric,
  ref_high numeric,
  created_at timestamptz not null default now()
);

create index if not exists lab_reports_user_date_idx on public.lab_reports (user_id, report_date desc);
create index if not exists lab_results_user_test_idx on public.lab_results (user_id, test_name);
create index if not exists lab_results_report_idx on public.lab_results (report_id);

alter table public.lab_reports enable row level security;
alter table public.lab_results enable row level security;

drop policy if exists lab_reports_owner_all on public.lab_reports;
create policy lab_reports_owner_all on public.lab_reports
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists lab_results_owner_all on public.lab_results;
create policy lab_results_owner_all on public.lab_results
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.lab_reports to authenticated;
grant select, insert, update, delete on public.lab_results to authenticated;
grant all on public.lab_reports to service_role;
grant all on public.lab_results to service_role;
