import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ENV_SUPABASE_URL, ENV_SUPABASE_ANON_KEY } from '../env'

let _client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient | null {
  if (!ENV_SUPABASE_URL || !ENV_SUPABASE_ANON_KEY) return null
  if (!_client) _client = createClient(ENV_SUPABASE_URL, ENV_SUPABASE_ANON_KEY)
  return _client
}

export const isSupabaseConfigured = (): boolean =>
  !!(ENV_SUPABASE_URL && ENV_SUPABASE_ANON_KEY)
