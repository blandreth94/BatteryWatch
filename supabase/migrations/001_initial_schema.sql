-- BatteryWatch — Supabase schema
-- All timestamps are Unix milliseconds (bigint).
-- sync_id is a client-generated UUID; it is the primary key in Supabase and
-- the conflict target for all upserts. The Dexie auto-increment `id` is never
-- sent to the server.
-- team_id partitions all data by FRC team number.

-- ── batteries ─────────────────────────────────────────────────────────────────

create table if not exists batteries (
  sync_id             text primary key,  -- equals battery id (e.g. "2026A")
  team_id             integer not null,
  id                  text not null,
  year                integer not null,
  label               text not null,
  cycle_count         integer not null default 0,
  internal_resistance numeric,
  notes               text not null default '',
  created_at          bigint not null
);

create index if not exists batteries_team_id on batteries (team_id);

-- ── charger_sessions ──────────────────────────────────────────────────────────

create table if not exists charger_sessions (
  sync_id                 text primary key,
  team_id                 integer not null,
  battery_id              text not null,
  slot_number             integer not null,
  placed_at               bigint not null,
  removed_at              bigint,
  voltage_at_placement    numeric,
  voltage_at_removal      numeric,
  resistance_at_placement numeric,
  is_full_cycle           boolean not null default false
);

create index if not exists charger_sessions_team_id    on charger_sessions (team_id);
create index if not exists charger_sessions_battery_id on charger_sessions (battery_id);

-- ── heater_sessions ───────────────────────────────────────────────────────────

create table if not exists heater_sessions (
  sync_id            text primary key,
  team_id            integer not null,
  battery_id         text not null,
  slot_number        integer not null,
  placed_at          bigint not null,
  removed_at         bigint,
  for_match_number   integer,
  moved_by           text,      -- person who moved battery from charger to heater
  removed_by         text,      -- person who pulled battery off heater (non-match)
  voltage_at_removal numeric
);

create index if not exists heater_sessions_team_id    on heater_sessions (team_id);
create index if not exists heater_sessions_battery_id on heater_sessions (battery_id);

-- ── usage_events ──────────────────────────────────────────────────────────────

create table if not exists usage_events (
  sync_id            text primary key,
  team_id            integer not null,
  battery_id         text not null,
  event_type         text not null,   -- 'match' | 'practice'
  match_number       integer,
  taken_at           bigint not null,
  returned_at        bigint,
  taken_by           text not null,
  voltage_at_take    numeric,
  resistance_at_take numeric,
  from_location      text not null,   -- 'charger' | 'heater' | 'pit'
  from_slot          integer,
  notes              text not null default ''
);

create index if not exists usage_events_team_id    on usage_events (team_id);
create index if not exists usage_events_battery_id on usage_events (battery_id);

-- ── match_records ─────────────────────────────────────────────────────────────

create table if not exists match_records (
  sync_id        text primary key,
  team_id        integer not null,
  match_number   integer not null,
  scheduled_time bigint not null,
  battery_id     text,
  completed_at   bigint,
  status         text not null   -- 'upcoming' | 'active' | 'complete'
);

create index if not exists match_records_team_id on match_records (team_id);

-- ── app_settings ──────────────────────────────────────────────────────────────
-- One row per team. sync_id = team_id cast to text.

create table if not exists app_settings (
  sync_id                text primary key,
  team_id                integer not null unique,
  event_name             text not null default '',
  team_number            integer not null,
  season_year            integer not null,
  heater_warm_minutes    integer not null default 30,
  walk_and_queue_minutes integer not null default 20,
  heater_slot_count      integer not null default 2,
  tba_api_key            text not null default '',
  tba_event_key          text not null default ''
);

-- ── Row-level security ────────────────────────────────────────────────────────
-- The anon key is the access control mechanism (stored as an env secret).
-- These policies allow all operations for the anon role.

alter table batteries        enable row level security;
alter table charger_sessions enable row level security;
alter table heater_sessions  enable row level security;
alter table usage_events     enable row level security;
alter table match_records    enable row level security;
alter table app_settings     enable row level security;

create policy "anon_all" on batteries        for all to anon using (true) with check (true);
create policy "anon_all" on charger_sessions for all to anon using (true) with check (true);
create policy "anon_all" on heater_sessions  for all to anon using (true) with check (true);
create policy "anon_all" on usage_events     for all to anon using (true) with check (true);
create policy "anon_all" on match_records    for all to anon using (true) with check (true);
create policy "anon_all" on app_settings     for all to anon using (true) with check (true);
