// Build-time env vars (VITE_ prefix required by Vite).
// Set in .env.local for local overrides, or as GitHub Actions secrets
// passed via --mode or vite build env injection.

export const ENV_TBA_API_KEY: string = import.meta.env.VITE_TBA_API_KEY ?? ''
export const ENV_TBA_EVENT_KEY: string = import.meta.env.VITE_TBA_EVENT_KEY ?? ''
export const ENV_EVENT_NAME: string = import.meta.env.VITE_EVENT_NAME ?? ''
export const ENV_TEAM_NUMBER: number = import.meta.env.VITE_TEAM_NUMBER
  ? parseInt(import.meta.env.VITE_TEAM_NUMBER as string, 10)
  : 0

export const ENV_SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? ''
export const ENV_SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''
// 'cloud' | 'local' — forces mode when set; otherwise user-controlled via Settings toggle.
export const ENV_STORAGE_MODE: string = import.meta.env.VITE_STORAGE_MODE ?? ''
