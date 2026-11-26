SELECT cron.schedule(
  'ai_insights_daily_dispatch',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://htooqswstuuzslvrgxsx.supabase.co/functions/v1/ai-insights-engine',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"action":"cronDispatch"}'::jsonb
  );
  $$
);
