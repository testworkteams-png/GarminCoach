-- Strictly additive migration: Active Intelligence (ai_insights) & notification preferences
-- Keeps all existing tables, rows, and policies intact.

CREATE TABLE IF NOT EXISTS public.ai_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  category text NOT NULL CHECK (category IN ('uyku', 'antrenman', 'toparlanma', 'genel')),
  title text NOT NULL,
  summary text NOT NULL,
  action_tip text NOT NULL,
  feedback smallint CHECK (feedback IN (1, -1)),
  last_activity_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_insights_user_date
  ON public.ai_insights (user_id, date DESC, created_at DESC);

ALTER TABLE public.ai_insights ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_insights'
      AND policyname = 'Users manage own ai_insights'
  ) THEN
    CREATE POLICY "Users manage own ai_insights"
      ON public.ai_insights
      FOR ALL
      TO authenticated
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_insights TO authenticated;
GRANT ALL ON public.ai_insights TO service_role;

ALTER TABLE public.athlete_settings
  ADD COLUMN IF NOT EXISTS ai_insights_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS daily_notification_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notification_time text NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS fcm_token text;
