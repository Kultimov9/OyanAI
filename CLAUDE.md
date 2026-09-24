# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Vite dev server (web)
npm run build      # Build web assets to dist/
npm run preview    # Preview production build
npm run lint       # ESLint with auto-fix
npm run format     # Prettier format src/
```

### Mobile (Capacitor)
After `npm run build`, sync and open the native project:
```bash
npx cap sync
npx cap open ios      # Opens Xcode
npx cap open android  # Opens Android Studio
```

## Environment Variables

Copy `.env` and set:
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anon key
The Anthropic API key is **not** a client variable: it lives only in the Supabase secret `ANTHROPIC_API_KEY`, used by the `ai` and `reengage` Edge Functions. Never add it back to `.env` — Vite would embed it in the app bundle.

## Path alias

`@` maps to `src/` — use `@/stores/habits`, `@/lib/supabase`, etc. in imports.

## Architecture

**Qadam** ("step" in Kazakh) is a habit/productivity mobile app built with Vue 3 + Vite, wrapped in Capacitor for iOS/Android. The web build (`dist/`) is the Capacitor webDir.

### Data flow
All persistent data lives in **Supabase** (habits, tasks, goals, reflections, profiles). The single Pinia store (`src/stores/habits.js`) is the source of truth in-session and is also persisted locally via `pinia-plugin-persistedstate`. Every store action performs an optimistic local update then syncs to Supabase.

On app mount (`App.vue`), if there is a valid session:
1. `store.fetchAll()` loads all user data from Supabase.
2. `setupNotifications()` schedules Capacitor local notifications.
3. If AI notifications haven't been generated today, `generateNotifications()` calls the Anthropic API and stores the result in the Pinia store.

### Authentication & routing (`src/router/index.js`)
The router guard checks the Supabase session on every navigation:
- No session → redirect to `/auth`
- Session + not onboarded → redirect to `/onboarding`
- Session on `/auth` → redirect to `/`

### AI (`src/composables/useAI.js`)
All Claude calls go through the `ai` Edge Function (`supabase/functions/ai`) via `callClaude(kind, system, message)`. The client builds the prompt; the server picks the model (`claude-haiku-4-5`) and token limit per `kind`, checks `profiles.ai_consent_at`, and enforces a daily per-user cap through the `ai_usage` table (`supabase/ai_usage.sql`). A `429` with `ai_limit` means the cap is reached.
- `askAI(message)` — chat with a personal coach that has full context of today's habits, tasks, goals, and the latest reflection.
- `generateGreeting()` — short personal greeting on the home screen.
- `generateNotifications()` — returns a JSON array of `{id, hour, minute, text}` objects used to schedule daily local notifications.

Every entry point first checks `hasAiConsent()`: no data is sent to Anthropic without the user's explicit consent (App Store 5.1.1(i)/5.1.2(i)).

AI chat history is stored in the Pinia store (`aiMessages`, `aiMessagesDate`) and cleared daily.

### Supabase tables
`habits`, `tasks`, `goals`, `reflections`, `profiles` — all filtered by `user_id`. Goals store `steps` as a JSONB array column. The `profiles` table has an `onboarded` boolean flag.

### Notifications
`src/composables/useNotifications.js` wraps `@capacitor/local-notifications`. Two fixed daily notifications (morning/evening, times configurable in store) plus AI-generated custom ones stored in the store.

### UI structure
- `src/views/` — one file per route/screen
- `src/components/BottomNav.vue` — tab bar shown on all screens except `/auth` and `/onboarding`
- `src/components/HeatMap.vue`, `ProgressChart.vue` — Chart.js visualizations used in ProgressView
- App is constrained to 430px max-width, styled for mobile; iOS bounce scroll is suppressed in `main.js`
