# TICKET-0 — Bootstrap (W9 definition)

- **Date:** 2026-07-05
- **Product:** cantai
- **Status:** DONE (recorded at repo creation)

## Mission

Cantai is a free, embeddable karaoke-queue platform any bar can run with zero setup: patrons scan/join, search YouTube for a song, and submit it to a shared queue; the venue screen plays the queue through the YouTube embedded player. Free early access for everyone; monetization later via a professional paid plan (and/or ads or gated pro features). A built-in feedback loop collects user feedback and feeds progressive development.

## Definition (agreed with TL, 2026-07-05-session-003)

- **Name/slug:** `cantai` (TL-chosen via modal)
- **Stack:** single Next.js app (App Router) — API routes + realtime queue + YouTube IFrame embed. Deviation from D-013 default, TL-approved for prototype speed. Can split into a NestJS API later if it grows.
- **Deploy target:** Vercel free tier (deviation from AWS/CDK default, TL-approved). Public HTTPS URL for early access.
- **Repo:** private, `paulosalvatore/cantai`.

## Product scope (from kickoff prompt, verbatim intent)

- YouTube-connected karaoke: search + embedded player (YouTube IFrame Player API — ToS-compliant, no downloading/stripping).
- Shared song queue; anyone can submit a song and it joins the line.
- Optional table number on submission.
- Participation modes per entry: **sing**, or **listen/dance** (music-only, no mic turn).
- Venue karaoke modes: **full karaoke** (everyone queues), **2 per table**, **one per person** — fair-rotation by user identity.
- User identity: anonymous `uuid + nickname` (no signup friction).
- Business model: free early access with everything available; later a paid professional plan and/or ads / gated pro features.
- Feedback loop: in-app feedback capture + a process loop where the house automatically collects, triages, and acts on user feedback for progressive development.

## Non-default constraints

- Prototype-first: prototype → MVP → PMF → 1.0 (house iteration model). Ship the smallest usable venue+patron flow before modes/monetization polish.
- No YouTube Data API key dependency for v0 if avoidable (quota/cost); if search needs it, keep the key server-side and document it in the needs-user round.
- Realtime: start with simple polling or SSE; only add websockets/hosted realtime if the prototype proves the need.

## Bootstrap checklist

- [x] Definition agreed (this file)
- [x] Repo created and template pushed
- [ ] Branch protection — SKIPPED: GitHub Free + private repo (known 403); gates are process-enforced (D-011)
- [ ] Needs-user round (W7): Vercel account link, YouTube API key (if needed)
- [ ] TICKET-1 — walking skeleton
- [ ] TICKET-2 — deploy pipeline (Vercel)
