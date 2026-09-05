-- © 2026 aiaiaiai · aiaiaiai.org
-- SPDX-License-Identifier: MPL-2.0

-- The durable failure table every 0x1 surface writes to. Columns mirror
-- FailureRecord in @nilx-one/application; a column added here without the
-- matching contract change is a column nothing will ever write.

create table if not exists public.failure_records (
  id bigint generated always as identity primary key,
  contract_version text not null,
  recorded_at_unix_ms bigint not null,
  surface text not null check (surface in ('web-client', 'web-host')),
  component text not null,
  code text not null,
  kind text not null
    check (kind in ('unavailable', 'withheld', 'gated', 'rejected', 'exhausted')),
  retryable boolean not null,
  release text,
  session_id text,
  operation_id text,
  context jsonb,
  -- Server-side arrival time. recorded_at_unix_ms is what the surface claimed;
  -- this is what the table observed, and the two disagreeing is itself a signal.
  received_at timestamptz not null default now()
);

create index if not exists failure_records_received_at_idx
  on public.failure_records (received_at desc);

create index if not exists failure_records_component_idx
  on public.failure_records (surface, component, received_at desc);

alter table public.failure_records enable row level security;

-- The anon key ships in a browser bundle, so it must be able to do exactly one
-- thing: append. No select, no update, no delete — a client that could read the
-- table could read every other client's failures.
drop policy if exists failure_records_anon_insert on public.failure_records;
create policy failure_records_anon_insert
  on public.failure_records
  for insert
  to anon
  with check (true);

revoke all on public.failure_records from anon;
grant insert on public.failure_records to anon;
