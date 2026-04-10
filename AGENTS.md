# AGENTS.md

## Project Description

PDL Dashboard is a full-stack deployment control panel for managing web projects hosted on a server.

- Frontend: React 19 + Vite + Tailwind CSS v4 (`/src`)
- Backend: Express 5 API (`/server/index.js`)
- Runtime role: Trigger deploy/update/maintenance/delete/rollback flows by shelling out to `manager.sh` and Docker Compose
- Primary deployment target paths:
  - `${WEBS_HOME}` (default `/home/pdl1host/webs`)
  - `${SRV_WEBS_HOME}` (default `/srv/webs`)

This repo is designed to run both locally (dev) and in containers (Docker Compose).

## Environment Prerequisites

- Node.js `20+`
- npm `10+`
- Docker + Docker Compose (for containerized run and backend orchestration features)
- Linux-like shell utilities expected by backend commands (`sh`, `git`, `docker`, `docker compose`)

## Build / Run Commands

### Root (frontend + orchestration)

- Install frontend deps:
  - `npm install`
- Run frontend only (Vite dev server):
  - `npm run dev`
- Run backend only from root:
  - `npm run backend`
- Run frontend + backend together:
  - `npm run dev:full`
- Production frontend build:
  - `npm run build`
- Preview built frontend:
  - `npm run preview`
- Lint frontend + backend JS with shared ESLint config:
  - `npm run lint`
- Start containers:
  - `npm run compose:up`
- Stop containers:
  - `npm run compose:down`

### Server subproject

- Install backend deps:
  - `npm --prefix server install`
- Run backend (dev/start are identical):
  - `npm --prefix server run dev`
  - `npm --prefix server run start`

### Default local URLs

- Frontend dev: `http://localhost:5173`
- Backend API: `http://localhost:3001`
- Docker dashboard: `http://localhost:8090` (default)

## Test Commands

No formal automated test suite is configured in this repo right now.

Use these quality gates instead:

- Static checks:
  - `npm run lint`
- Build validation:
  - `npm run build`
- Smoke test (manual):
  - Start with `npm run dev:full`
  - Verify UI loads and backend endpoints respond
  - Trigger one safe action (e.g. project sync/rollback list) and watch job polling UI

If adding tests, prefer:

- Frontend: Vitest + React Testing Library
- Backend: supertest for API routes and command-building logic

## Architecture Overview

### High-level

- `src/App.jsx` is the main UI shell and contains most client behavior/state.
- UI calls backend using `API_BASE = http://<current-host>:3001`.
- Backend executes operational shell commands and returns either:
  - Immediate command result, or
  - Realtime job ID for polling
- Jobs are tracked in memory (`jobs` map) with buffered logs and status.
- Persistent project metadata is stored in `server/dashboard-state.json`.

### Backend command execution model

- Core route: `POST /api/execute`
- `buildCommand()` maps requested actions to shell commands:
  - `deploy`, `offair`, `update`
  - `delete_soft`, `restore`, `delete_hard`
  - `rollback_apply`
- Realtime mode uses `spawn('sh', ['-lc', command])` and captures stdout/stderr line-by-line.
- Job progress API: `GET /api/jobs/:jobId?from=<offset>`

### Metadata/state model

Per-project metadata includes:

- `lifecycle`: `active | maintenance | pending_delete | deleted`
- `runtime`: `domain`, `port`, maintenance window timestamps
- `rollbackMeta`: current/previous SHA and recent commits
- `deleteMeta`: soft/hard delete timestamps

Soft-delete sweep runs every 60s and auto-triggers hard delete when TTL expires.

### Domain discovery model

Backend builds domain catalog from 3 sources:

- Traefik Docker labels
- Traefik dynamic config (`dynamic.yml`)
- Local `domains.txt` under WEBS paths

Catalog is cached for 30s and served via `/api/domains/catalog`.

### Primary API surface

- `POST /api/execute`
- `GET /api/jobs/:jobId`
- `GET /api/projects`
- `POST /api/projects/sync`
- `GET /api/rollback/:folder/list`
- `GET /api/check-dns`
- `GET /api/domains/catalog`
- `POST /api/domains/reload`

## Key File Locations

### Root

- `package.json`: root scripts and frontend deps
- `README.md`: setup + operational notes
- `docker-compose.yml`: frontend + backend services
- `Dockerfile`: frontend build image (Vite build -> nginx)
- `manager.sh`: operational script for deploy/update/offair/delete/rollback
- `.env.example`: compose/runtime env defaults
- `eslint.config.js`: shared lint config for frontend and backend

### Frontend (`src/`)

- `src/main.jsx`: React app bootstrap
- `src/App.jsx`: main UI, API calls, modals, action handling
- `src/index.css`: Tailwind import, theme tokens, utility/custom styles

### Backend (`server/`)

- `server/index.js`: Express API and shell/job orchestration
- `server/package.json`: backend scripts/deps
- `server/Dockerfile`: backend container image
- `server/.env.example`: backend env defaults
- `server/dashboard-state.json`: runtime-generated persisted metadata (created at runtime)

### Legacy/auxiliary

- `server_index_new.js`: older alternate backend entrypoint; not used by current scripts
- `TROUBLESHOOTING.md`: operational incident notes
- `Design_Plan.md`: UI planning document

## Coding Conventions

## JavaScript / React

- Frontend uses ESM (`"type": "module"` in root `package.json`); backend uses CommonJS (`"type": "commonjs"` in `server/package.json`).
- Keep semicolon-terminated statements (existing style in both frontend/backend).
- Prefer `const`; use `let` only when reassignment is required.
- Prefer functional React with hooks (`useState`, `useEffect`, `useMemo`, `useCallback`).
- Keep helper functions near usage unless truly shared.
- Maintain explicit user-facing error handling for network and command failures.

## Styling

- Use Tailwind utility classes for component-level layout/styling.
- Keep design tokens aligned with `src/index.css` theme variables and `tailwind.config.js` colors.
- Avoid ad-hoc inline styles unless dynamic values are required.

## Linting and quality

- Run `npm run lint` before merging changes.
- ESLint ignores build artifacts and node modules.
- `no-unused-vars` is enforced; naming placeholders with leading uppercase/underscore can intentionally bypass rule when needed.

## Backend safety and shelling out

- Always sanitize folder/input values before interpolating shell commands (follow `normalizeFolder` pattern).
- Preserve existing guardrails around rollback SHA validation and domain normalization.
- When adding new actions, update:
  - `buildCommand()`
  - `/api/execute` success metadata patching
  - frontend action handlers/polling UI as needed

## Configuration conventions

- Keep env defaults in `.env.example` and `server/.env.example`.
- Do not hardcode server-specific absolute paths outside env-driven defaults.
- Use `WEBS_HOME`/`SRV_WEBS_HOME` consistently across backend and compose.

## Contribution Checklist

- Install deps for both layers (`npm install` and `npm --prefix server install`)
- Run `npm run lint`
- Run `npm run build`
- Manually verify key UI actions against backend (`dev:full`)
- Update `README.md` and this file (`AGENTS.md`) when commands/architecture/API change
