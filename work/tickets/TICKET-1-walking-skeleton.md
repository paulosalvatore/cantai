# TICKET-1 — Walking skeleton: prototype core (join → submit → queue → play)

- **Date:** 2026-07-05
- **Product:** cantai
- **Status:** IN PROGRESS
- **Autonomy:** fully autonomous gate chain (D-028 pattern); TM merges per D-043

## Goal

A bootable Next.js app that already IS the minimal karaoke prototype: a patron joins a room with a nickname (uuid generated client-side), submits a YouTube song to a shared queue (optionally with table number and a sing / listen-dance flag), and a venue screen page plays the queue in order through the YouTube IFrame Player, auto-advancing on video end.

## Scope (in)

1. **Next.js app (App Router, TypeScript)** at repo root. `npm run dev` boots it; replace the `run-app` skill stub with real instructions (pick a dedicated port not used by other house products — 3000/3020/5434/5435 are taken elsewhere; use **3040**).
2. **Room model (single default room is fine for v0)** — in-memory store on the server (module-level Map) is acceptable for the prototype; document the restart-loses-state limitation. No DB yet.
3. **Patron page `/`**: enter nickname (uuid v4 generated and kept in localStorage), paste a YouTube URL (accept full/short/watch URLs; parse the video ID — no YouTube Data API key), optional table number, mode toggle sing vs listen/dance. Submit → POST to API → appears in queue. Shows the live queue (poll every ~3s) with position, nickname, table, mode badge.
4. **Venue screen `/tv`**: YouTube IFrame Player API embed playing the current queue item; auto-advance to next on end (and a manual skip button); shows now-playing (song + nickname + table + mode) and the next few entries. Poll for queue updates.
5. **API routes**: `GET /api/queue`, `POST /api/queue` (add entry: videoId, title optional, nickname, uuid, table?, mode), `POST /api/queue/advance` (skip/next). Validate inputs.
6. **Tests**: unit tests for the YouTube-URL parser + queue ordering logic; ONE Playwright e2e (patron submits a song → it appears in the queue list). CI (`.github/workflows/ci.yml`) replaced with real setup-node + build + test + e2e.
7. **README**: how to run, port, known prototype limitations.

## Scope (out — later tickets)

- Venue rotation modes (2-per-table, one-per-person fairness) — TICKET-3 candidate.
- Multiple rooms / venue codes, QR join.
- YouTube search by text (needs Data API key — needs-user item).
- Persistence (DB), auth, paid plan, ads, feedback widget + feedback loop.
- Deploy (TICKET-2, Vercel).

## Constraints

- YouTube playback ONLY via the official IFrame Player API (ToS-compliant). Never download/proxy media.
- No secrets needed for this ticket.
- Worktree at `.worktrees/ticket-1` (D-033); all work via PR; gates sequential (D-007); verdict comments (D-011); commits via the commit skill only.

## Acceptance

- `npm run dev` on :3040 → `/` and `/tv` work end-to-end locally (submit on one tab, plays on the other).
- Unit tests + 1 Playwright e2e green locally and in CI.
- Dev report in `work/reports/dev/TICKET-1.md`; evidence screenshots via capture-screenshots into `work/evidence/ticket-1/`.
