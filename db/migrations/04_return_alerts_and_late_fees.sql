-- ==============================================================================
-- Kitchenware Rentals (KWR) ERP Database Migration: 04
-- Purpose:
-- 1. PERSIST THE HIRE PERIOD. Until now start/end dates lived only in the
--    browser's localStorage and on the printed PDF, so no server-side process
--    (and no second device) could tell when an item was due back. This is the
--    prerequisite for any reminder system.
-- 2. Store the late-fee policy and the reminder schedule in app_settings so the
--    rate, grace period, cap and reminder offsets are configurable.
-- 3. Create reminder_log so every reminder that was sent is traceable, and so
--    the UI can show "last reminded" and avoid nagging the same customer twice.
--
-- Safe to run more than once. Run this AFTER migration 02.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. HIRE PERIOD ON ORDERS
-- ------------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date DATE;

COMMENT ON COLUMN public.orders.start_date IS 'Hire period start (inclusive), captured from the invoicing form';
COMMENT ON COLUMN public.orders.end_date IS 'Hire period end / DUE DATE (inclusive). Null means the period was never recorded.';

-- Backfill the start date from the legacy order_date. The END date cannot be
-- invented: rows created before this migration keep end_date NULL and are
-- surfaced in the UI as "period not recorded" rather than silently guessed.
UPDATE public.orders
   SET start_date = order_date
 WHERE start_date IS NULL
   AND order_date IS NOT NULL;

-- Every open-hire query filters on end_date, so index it. A partial index keeps
-- the hot path small: RETURNED/CANCELLED rows never need to be scanned.
CREATE INDEX IF NOT EXISTS idx_orders_end_date
  ON public.orders(end_date);

CREATE INDEX IF NOT EXISTS idx_orders_open_hire_due
  ON public.orders(end_date)
  WHERE status IN ('CONFIRMED', 'OUT_ON_HIRE');

-- ------------------------------------------------------------------------------
-- 2. APPLICATION SETTINGS (late-fee policy + reminder schedule)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ DEFAULT now(),
  updated_by  TEXT
);

COMMENT ON TABLE public.app_settings IS 'Editable operational policy: late-return fee rules and reminder cadence';

INSERT INTO public.app_settings (key, value) VALUES
  (
    'late_fee_policy',
    -- perDayRate: flat naira per day, per invoice
    -- graceDays:  free days after the due date before charging starts
    -- cap:        0 = uncapped
    '{"perDayRate": 5000, "graceDays": 1, "cap": 0}'::jsonb
  ),
  (
    'reminder_schedule',
    -- offsets are days relative to the DUE DATE.
    -- negative = before due, 0 = due date, positive = overdue.
    '{"offsets": [-3, -1, 0, 1, 3, 7], "channels": ["whatsapp", "sms", "email"]}'::jsonb
  )
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 3. REMINDER LOG
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reminder_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID,
  order_no    VARCHAR(64),
  channel     VARCHAR(16) NOT NULL,
  kind        VARCHAR(16) NOT NULL,
  due_date    DATE,
  days_offset INTEGER,
  message     TEXT,
  status      VARCHAR(16) DEFAULT 'OPENED',
  sent_by     TEXT,
  sent_at     TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.reminder_log IS 'One row per reminder opened by a staff member: channel, tone, due date and the exact message body';
COMMENT ON COLUMN public.reminder_log.kind IS 'DUE_SOON, DUE_TODAY or OVERDUE';
COMMENT ON COLUMN public.reminder_log.status IS 'OPENED (deep link launched), FAILED, or SENT if a provider later posts back';

CREATE INDEX IF NOT EXISTS idx_reminder_log_order_no ON public.reminder_log(order_no);
CREATE INDEX IF NOT EXISTS idx_reminder_log_sent_at ON public.reminder_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_reminder_log_order_channel ON public.reminder_log(order_no, channel, kind);

-- ------------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
--    Matches the convention already used by this project: the browser is the
--    trust boundary and roles are enforced in the UI (auth.canAccessTab).
--    Restricting differently here would break the existing app-wide policies.
-- ------------------------------------------------------------------------------
ALTER TABLE public.app_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_log  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow settings access" ON public.app_settings;
CREATE POLICY "Allow settings access"
  ON public.app_settings FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow reminder log insert" ON public.reminder_log;
CREATE POLICY "Allow reminder log insert"
  ON public.reminder_log FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow reminder log read" ON public.reminder_log;
CREATE POLICY "Allow reminder log read"
  ON public.reminder_log FOR SELECT
  USING (true);

-- ------------------------------------------------------------------------------
-- 5. VERIFICATION
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  missing_end INTEGER;
  open_rows   INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing_end
    FROM public.orders
   WHERE end_date IS NULL
     AND status IN ('CONFIRMED', 'OUT_ON_HIRE');

  SELECT COUNT(*) INTO open_rows
    FROM public.orders
   WHERE status IN ('CONFIRMED', 'OUT_ON_HIRE');

  RAISE NOTICE 'Migration 04 complete. Open rentals: %, of which % have no recorded due date (they will show as "period not recorded" and must be edited once).', open_rows, missing_end;
END $$;

COMMIT;
