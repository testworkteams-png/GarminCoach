-- Faz 2+: Kan tahlili rapor bazlı ve birleşik AI yorumu önbelleği

alter table public.lab_reports
  add column if not exists ai_summary text;

create table if not exists public.lab_ai_overview (
  user_id uuid primary key references auth.users(id) on delete cascade,
  fingerprint text not null,
  summary text not null,
  updated_at timestamptz not null default now()
);

alter table public.lab_ai_overview enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'lab_ai_overview'
      and policyname = 'lab_ai_overview_owner_all'
  ) then
    create policy lab_ai_overview_owner_all
      on public.lab_ai_overview
      for all
      to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;
end $$;

grant select, insert, update, delete on table public.lab_ai_overview to authenticated, service_role;
