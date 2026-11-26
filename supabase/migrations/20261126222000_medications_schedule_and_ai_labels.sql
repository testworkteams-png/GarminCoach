-- Faz 2+: Eczane etiketi AI tarama, tedavi süresi, gerektiğinde (PRN) ve hatırlatıcı tercihleri

alter table public.medications
  add column if not exists purpose text,
  add column if not exists end_date date,
  add column if not exists duration_days integer,
  add column if not exists as_needed boolean not null default false,
  add column if not exists reminder_enabled boolean not null default true;
