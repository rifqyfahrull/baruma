-- Unified AI Agent chat: one durable project thread across Brief, Denah,
-- Interior, and the rest of the project workspace.

ALTER TABLE assistant_messages ADD COLUMN IF NOT EXISTS surface text;
ALTER TABLE assistant_messages ADD COLUMN IF NOT EXISTS turn_id text;
ALTER TABLE assistant_messages ADD COLUMN IF NOT EXISTS client_request_id text;
ALTER TABLE assistant_messages ADD COLUMN IF NOT EXISTS request_state text;
ALTER TABLE assistant_messages ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

UPDATE assistant_messages
   SET surface = mode
 WHERE surface IS NULL;

-- Historical rows cannot be paired reliably after the fact. Giving every row
-- its own turn preserves ordering and lets the new reader treat them as
-- completed legacy messages without inventing relationships.
UPDATE assistant_messages
   SET turn_id = id
 WHERE turn_id IS NULL;

UPDATE assistant_messages
   SET request_state = 'completed'
 WHERE role = 'user'
   AND request_state IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'assistant_messages'::regclass
      AND conname = 'assistant_messages_request_state_check'
  ) THEN
    ALTER TABLE assistant_messages
      ADD CONSTRAINT assistant_messages_request_state_check
      CHECK (request_state IS NULL OR request_state IN ('pending','completed','failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS assistant_messages_project_order_idx
  ON assistant_messages (project_id, created_at, id);

CREATE INDEX IF NOT EXISTS assistant_messages_turn_idx
  ON assistant_messages (project_id, turn_id);

CREATE UNIQUE INDEX IF NOT EXISTS assistant_messages_turn_role_unique
  ON assistant_messages (project_id, turn_id, role);

CREATE UNIQUE INDEX IF NOT EXISTS assistant_messages_request_unique
  ON assistant_messages (project_id, client_request_id)
  WHERE role = 'user' AND client_request_id IS NOT NULL;

-- Project Agent spends/refunds use clientRequestId as `ref`. The partial
-- unique index makes retrying the same request incapable of charging or
-- refunding twice, while leaving every historical ledger category untouched.
CREATE UNIQUE INDEX IF NOT EXISTS credits_ledger_project_agent_once
  ON credits_ledger (profile_id, reason, ref)
  WHERE reason IN ('project_agent', 'project_agent_refund') AND ref IS NOT NULL;
