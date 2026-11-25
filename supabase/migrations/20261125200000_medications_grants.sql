grant usage on schema public to authenticated;
grant select, insert, update, delete on public.medications to authenticated;
grant select, insert, update, delete on public.medication_logs to authenticated;
grant all on public.medications to service_role;
grant all on public.medication_logs to service_role;
