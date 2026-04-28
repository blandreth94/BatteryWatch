-- Enable Supabase Realtime on all BatteryWatch tables so clients receive
-- row-level push notifications instead of polling.

alter publication supabase_realtime add table batteries;
alter publication supabase_realtime add table charger_sessions;
alter publication supabase_realtime add table heater_sessions;
alter publication supabase_realtime add table usage_events;
alter publication supabase_realtime add table match_records;
alter publication supabase_realtime add table app_settings;
