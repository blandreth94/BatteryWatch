# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

BatteryWatch is a PWA for FRC Team 401 (Copperhead Robotics) to manage competition batteries across 9 charging slots (3 three-bay chargers). It tracks charge cycles, heater warm-up sessions, match assignments, and suggests the next battery to heat and use based on usage history. Hosted on GitHub Pages with all data stored in IndexedDB (no backend).

## Commands

```bash
npm run dev          # Start Vite dev server (HMR)
npm run build        # TypeScript check + production build to dist/
npm run preview      # Serve dist/ locally to test PWA behavior
npm run lint         # ESLint
npm test             # Vitest unit tests (primarily for src/engine/suggestions.ts)
npm run test:ui      # Vitest with browser UI
```

All `npm`/`node` commands must be run inside Docker via OrbStack — never on the host.

Deploy is automated via `.github/workflows/deploy.yml` on push to `main` — builds and pushes `dist/` to the `gh-pages` branch.

## Architecture

### Data layer — Dexie (IndexedDB)

All persistence goes through **Dexie 4** (`src/db/schema.ts`). The Dexie instance is the single source of truth. Never write to IndexedDB directly — always use the Dexie table APIs. `null` in `removedAt` is the sentinel for "currently active" on a charger or heater slot.

Tables: `batteries`, `chargerSessions`, `heaterSessions`, `usageEvents`, `matchRecords`, `settings` (single-row, key `"settings"`), `pendingSync` (offline queue).

### Data layer — Supabase (optional cloud sync)

Supabase is an optional cloud backend. When configured (via `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`), all mutations are queued in the `pendingSync` Dexie table and flushed to Supabase asynchronously. The app works fully offline; the queue flushes on reconnect.

- `src/sync/syncEngine.ts` — push/pull logic, pending queue, mode detection
- `src/sync/supabaseClient.ts` — lazy Supabase singleton
- `src/store/useSync.ts` — React hook exposing sync status
- `supabase/migrations/` — SQL migration files (canonical Supabase schema)

**Storage mode** is controlled by the `VITE_STORAGE_MODE` env var (`"cloud"` | `"local"`) or a per-device localStorage toggle when the env var is absent.

### The sync contract — MUST update all four locations for every field change

When adding, renaming, or removing a field on any persisted TypeScript type:

| # | Location | What to change |
|---|----------|----------------|
| 1 | `src/types/index.ts` | TypeScript interface |
| 2 | `_buildRow()` in `src/sync/syncEngine.ts` | Dexie → Supabase (push) |
| 3 | `pullFromSupabase()` in `src/sync/syncEngine.ts` | Supabase → Dexie (pull) |
| 4 | `supabase/migrations/` | New `NNN_*.sql` file with `ALTER TABLE` |

Also bump the Dexie version in `src/db/schema.ts` if adding a column that needs to be **indexed** (most optional fields don't need an index and require no Dexie version bump).

#### Supabase column naming convention
Dexie uses camelCase; Supabase uses snake_case. The mapping is straightforward:
`batteryId` → `battery_id`, `placedAt` → `placed_at`, `isFullCycle` → `is_full_cycle`, etc.

#### Supabase table names
| Dexie table | Supabase table |
|-------------|----------------|
| `batteries` | `batteries` |
| `chargerSessions` | `charger_sessions` |
| `heaterSessions` | `heater_sessions` |
| `usageEvents` | `usage_events` |
| `matchRecords` | `match_records` |
| `settings` | `app_settings` |

### Reactivity

**`dexie-react-hooks` `useLiveQuery`** is the reactivity model — components re-render automatically when IndexedDB data changes. There is no Redux, Zustand, or other state library. Store hooks live in `src/store/` and expose `useLiveQuery` results alongside Dexie mutation helpers.

### Suggestion engine

`src/engine/suggestions.ts` exports two **pure functions** with no side effects, no DB calls, and no React dependencies:
- `computeHeaterSuggestions(...)` — which batteries to place in the 2 heater slots, and when. Slot 1 targets the next match, slot 2 the match after. Candidates are charger batteries charged ≥ 1 hour, sorted by longest charge time first.
- `rankBatteriesForNextMatch(...)` — "next up" pick from warm batteries, prioritizing longest rest since last match.

These are called from `useSuggestions()` in `src/store/`, which feeds them live Dexie data and a 30-second timer. All unit tests target these functions.

### Routing

**`HashRouter`** (react-router-dom v6) is required — GitHub Pages cannot handle path rewrites. Current routes: `/#/` (Dashboard), `/#/batteries`, `/#/schedule`, `/#/settings`.

### Styling

CSS custom properties only — no CSS framework. Team colors defined in `src/styles/global.css`:
- `--color-primary`: copper/orange (`#c8732a`, Team 401 Copperhead colors)
- `--color-bg`: near-black `#1a1a1a`
- `--color-surface`: dark card surface
- `--color-text`: white

UI is mobile-first with a bottom tab bar. Desktop layout switches at a CSS breakpoint in `src/styles/layout.css`.

### PWA

`vite-plugin-pwa` with `GenerateSW` strategy handles the service worker (`skipWaiting: true`, `clientsClaim: true` for immediate activation on update). The `base` in `vite.config.ts` must match the GitHub repo path (`/BatteryWatch/`). Icons at `public/icons/` must include 192px, 512px, and a maskable variant.

## Key files

| File | Purpose |
|------|---------|
| `src/types/index.ts` | All TypeScript interfaces — start here when adding features |
| `src/db/schema.ts` | Dexie database class + versioned migrations |
| `src/sync/syncEngine.ts` | Cloud sync push/pull logic — update `_buildRow` and `pullFromSupabase` for every field change |
| `src/engine/suggestions.ts` | Core algorithm — pure functions, fully unit-testable |
| `src/App.tsx` | Router shell, global context, bottom nav |
| `vite.config.ts` | Build config including `base` path and PWA plugin |
| `supabase/migrations/` | Supabase SQL migrations — keep in sync with `src/types/index.ts` |
| `.github/workflows/deploy.yml` | CI/CD to GitHub Pages |
