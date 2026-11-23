-- Day Planner: run this once in Supabase → SQL Editor → New query → Run.
-- Creates the "events" table the app reads and writes.

create table if not exists public.events (
  id         uuid primary key,
  title      text        not null check (char_length(title) between 1 and 200),
  start_at   timestamptz not null,
  end_at     timestamptz not null,
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);

create index if not exists events_start_at_idx on public.events (start_at);

-- No login: anyone with the app's URL + key can read and edit events.
-- (Row Level Security is on, with policies that allow everything.)
alter table public.events enable row level security;

drop policy if exists "Public read"   on public.events;
drop policy if exists "Public insert" on public.events;
drop policy if exists "Public update" on public.events;
drop policy if exists "Public delete" on public.events;

create policy "Public read"   on public.events for select to anon using (true);
create policy "Public insert" on public.events for insert to anon with check (true);
create policy "Public update" on public.events for update to anon using (true) with check (true);
create policy "Public delete" on public.events for delete to anon using (true);

grant select, insert, update, delete on public.events to anon;
