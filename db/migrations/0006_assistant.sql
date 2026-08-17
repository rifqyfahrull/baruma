-- AI assistant conversation history (one unified thread per project).
create table assistant_messages (
  id            text primary key,
  project_id    text not null references projects(id) on delete cascade,
  mode          text not null,            -- 'floorplan' | 'interior'
  role          text not null,            -- 'user' | 'assistant'
  content       text not null,
  actions       jsonb,                    -- AssistantAction[] (raw, for apply)
  action_labels jsonb,                    -- string[] (describeAction at creation)
  status        text,                     -- null | 'proposed' | 'applied' | 'dismissed'
  created_at    timestamptz not null default now()
);
create index assistant_messages_thread on assistant_messages (project_id, created_at);
