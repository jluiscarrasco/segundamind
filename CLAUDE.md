# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**SecondaMind** (branded "JL's Brain" / MiClario.com) — a personal knowledge-management PWA: a hierarchy of **Area → Project → Task**, plus a universal Inbox, a per-entity Wiki (Markdown), file storage, and AI-assisted capture. It also exposes an **MCP server** so Claude can read/write the same data (this is the `segundamind` MCP: `list_areas`, `list_tasks`, `create_task`, `search`, wiki tools, etc.).

Stack: Vite + React 18 + TypeScript + shadcn/ui (Radix) + Tailwind. Backend is **Firebase** (Auth, Firestore, Storage, Cloud Functions). The app was migrated off Supabase/Lovable — see "Legacy / migration state" below.

## Commands

```sh
npm run dev          # concurrently: Vite UI (:8080) + dev API server (tsx server.ts, :8082)
npm run dev:ui       # Vite only
npm run dev:server   # dev API only (server.ts)
npm run build        # production build (tsc + vite build)
npm run lint         # eslint
npm run test         # vitest run (single pass)
npm run test:watch   # vitest watch
npx vitest run src/lib/scoring.test.ts   # run a single test file
```

Firebase (Cloud Functions live in `functions/`, their own npm package):

```sh
cd functions && npm run build            # tsc — REQUIRED before deploy (firebase.json predeploy runs it)
firebase deploy --only functions --project secondbrain-765b9
firebase deploy --only firestore:rules --project secondbrain-765b9
firebase functions:log --project secondbrain-765b9
```

Package manager: repo has both `bun.lock` and `package-lock.json`; commands above assume npm. The Firebase project id is `secondbrain-765b9`.

## Two backends, one API surface — read this before touching AI/MCP code

The frontend calls `/api/*`. In dev, Vite proxies `/api` → `http://localhost:8082`. **What answers on 8082 depends on how you started things:**

- **`server.ts`** (root) — the lightweight *dev-only* Express server run by `npm run dev`. Implements a subset (classify-inbox, enrich-url, scrape-and-summarize, analyze-attachment, transcribe-audio, ai-assistant). Wiki + MCP routes here are **501 placeholders**. Despite the `GEMINI_API_KEY` env name, it actually calls **Groq** (`llama-3.3-70b-versatile`, Whisper `whisper-large-v3-turbo`).
- **`functions/src/index.ts`** (~1600 lines, `exports.api`) — the *real production* backend, a single Express app mounted at both `/api` and `/`. This is the authoritative implementation of everything: all AI endpoints, all wiki-* routes, the OAuth flow, and the **MCP endpoint**.

When changing an AI/wiki endpoint, check whether it needs to change in **both** files. `server.ts` is a convenience mirror that drifts; `functions/src/index.ts` is source of truth for prod.

`src/lib/cloud-functions.ts` is the typed client the frontend uses (`cloudFunctions.classifyInbox(...)`, `aiAssistantStream(...)`). It attaches the Firebase ID token as `Authorization: Bearer` and an App Check header.

## MCP server (`/mcp` in `functions/src/index.ts`)

- JSON-RPC 2.0 at `router.all('/mcp')`. Handles `initialize`, `tools/list`, `tools/call`, plus an OAuth approve/token dance.
- **Auth = personal tokens**, not Firebase ID tokens. Users mint an `mcp_…` token in the app's "Acceso para Claude (MCP)" dialog (`McpAccessDialog.tsx`). Only the SHA-256 **hash** is stored in the `api_tokens` collection; `verifyMcpToken()` hashes the incoming bearer and looks it up, returning the owning `userId`. **Every tool is scoped to that userId** — never return cross-user data.
- Tool definitions live in the `MCP_TOOLS` array; dispatch is `runMcpTool(name, args, userId)`. To add a tool: add to `MCP_TOOLS` (name + description + inputSchema) **and** add a `case` in `runMcpTool`. Descriptions are in Spanish (user-facing to Claude).
- Firestore timestamps are converted to ISO strings via `toIso()` before returning; ownership is enforced with `fetchOwned()` / `getOwnedDoc()`.

## Data model (Firestore)

Canonical types are in `src/types/index.ts` — treat it as the schema. Collections (all documents carry `userId`, camelCase fields):

`areas`, `projects`, `tasks`, `inbox_items`, `wiki_pages`, `resources`, `user_files`, `user_folders`, `user_file_links`, `user_file_tags`, `api_tokens`, `oauth_codes`, `push_subscriptions`, `allowed_emails`.

Key modeling facts:
- **Hierarchy**: Area → Project → Task. Projects have a 3-letter `key` (e.g. `SEC`) and a `taskCounter`; tasks have a `taskNumber`, and display IDs are `KEY-N` (`getTaskDisplayId`).
- Shared enums: `Importance` (critical/important/normal/low/none) and `Status` (funnel/ready/blocked/waiting/active/finished) — defined once in `types/index.ts` with `_LABELS` maps for Spanish UI. Use these, don't invent new status strings.
- `wiki_pages` and `resources` attach to any entity via `entityType` + `entityId`.

## Frontend data flow

- `src/store/useStore.ts` (via `StoreContext`) is the single Firestore data layer. On login it opens **`onSnapshot` real-time listeners** per collection (areas, projects, tasks, inbox_items, resources, wiki_pages), all filtered `where('userId','==',uid)`. Mutations are optimistic — on write failure the live listener restores server truth.
- `src/integrations/firebase/config.ts` initializes Firebase. Note the deliberate config: `experimentalAutoDetectLongPolling` (fixes WebChannel errors on mobile/VPN/proxy networks) and `persistentLocalCache` with IndexedDB (prevents full-collection re-reads / read-count spikes on listener reconnect). Don't remove these casually — the comments explain the incidents they fix.
- **App Check** only runs in production builds (reCAPTCHA v3). In local dev it's disabled on purpose (the exchange 403s and then self-throttles for 24h).
- Auth is `src/contexts/AuthContext.tsx` (Firebase Auth, email/password). Access is gated by the `allowed_emails` collection.
- `src/lib/scoring.ts` computes task priority from importance × status multiplier (used by the "Ahora"/focus and backlog views).
- Path alias `@` → `src/`.

## Legacy / migration state

- `src/integrations/supabase/` and `supabase/` still exist but are **legacy** — the app runs on Firebase. `MIGRATION_STATUS.md` / `MIGRATION.md` track the (mostly complete) Supabase→Firebase migration. Prefer Firebase paths; don't add new Supabase code.
- README.md still contains stale Lovable boilerplate (deploy-via-Lovable, wrong port). Trust this file and the code over the README.
- `scripts/migrate-supabase-to-firebase.js` is a one-off migration tool.

## Conventions

- UI is **Spanish** (labels, MCP tool descriptions, AI prompts). Match existing Spanish copy in user-facing strings.
- shadcn/ui components live in `src/components/ui/` (generated — avoid hand-editing; use `components.json` conventions).
- AI endpoints degrade gracefully: every AI call has a non-AI fallback so the feature still returns something if the LLM/API key is unavailable. Preserve that pattern when adding endpoints.
