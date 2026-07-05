# TICKET-11 — Feedback widget + API + durable feedback store (product side)

- **Date:** 2026-07-05 · **Product:** cantai · **Author:** Product Owner (TICKET-19 batch)
- **Wave:** 2 (after TICKET-6 merges — feedback must NEVER be in-memory; losing feedback is losing the product's fuel)
- **Depends on:** TICKET-6 (persistence layer/client). Blocks: backlog #12-house-side agent loop (framework-side, D-046 — NOT in this batch) and #15 close-the-loop.
- **Sizing:** S-M

## Goal

Any patron or host can say something in under 5 seconds without leaving the page — sentiment-only in two taps, uuid+context auto-attached. This is the intake mouth of the product's core differentiator (the automated feedback→development loop, TL verbatim intent).

## Spec source (authoritative — implement Part A)

`work/planning/feedback-loop.md` Part A (merged). Summary of the binding points:

- Floating button on patron pages + host view; **NOT on `/tv`** (spec AC7).
- Sheet: 1-tap sentiment (😍 🙂 😕 😡) — submit enabled on sentiment alone; optional free text; optional category chips (song search, queue/fairness, TV player, other). No email, no login, no captcha.
- Auto-context: `uuid, nickname, roomId/sessionId, route, mode, role (patron|host), appVersion (git sha), locale, coarse userAgent, server createdAt`. No PII beyond the chosen nickname.
- `POST /api/feedback`: validate, rate-limit 5/uuid/hour server-side, write to durable store.
- Record: `{ id, sentiment, text?, category?, context{...}, status: "new"|"triaged"|"planned"|"shipped"|"dismissed", triageRef? }` — `status` powers the future close-the-loop.
- House read path: `GET /api/feedback?since=<watermark>` guarded by a server-side `FEEDBACK_ADMIN_TOKEN` (never client-shipped) + matching status-update write path (the intake agent flips `new → triaged`).
- Confirmation copy states the promise: "Valeu! Um robô supervisionado por humanos lê cada um desses. Fica de olho no changelog." (pt-BR-first; the spec's English line is the intent, not the copy).
- Contextual micro-prompts (max 1/session, dismissible): after first song played; after host session end. Ship if cheap; droppable to a follow-up if the sheet+API consume the budget — note in the dev report either way.

## Scope — in

Widget component + sheet, the API routes above, `lib/feedback-store.ts` on the TICKET-6 persistence client (own module, own keys), rate limiting, unit tests (validation, rate limit) + e2e (2-tap submit), `.env.example` (`FEEDBACK_ADMIN_TOKEN`).

## Scope — out

House-side mining agent (framework repo per D-046 — the TM files it there), changelog page + notifications (#15), analytics views (#16), screenshots/attachments.

## File ownership (parallel-dev boundaries)

- **Owns:** `components/FeedbackWidget.tsx` + `components/feedback/**` (new), `app/api/feedback/**` (new), `lib/feedback-store.ts` (new), `app/layout.tsx` (SOLE owner in this batch — the injection point for the widget; guard against rendering on `/tv` routes), its tests/e2e, `.env.example` (append one line).
- **Must not touch:** `lib/store.ts` / `lib/store/**` (use the shared persistence client, not the queue store), `app/tv/**`, `app/admin/**` page internals (the widget mounts via layout, not per-page edits), search/rotation/telemetry files.

## Acceptance criteria

Spec ACs 1–4 and 7 of `work/planning/feedback-loop.md` (2-tap sentiment-only submit; full auto-context without user input; durable across deploys + watermark read path with token guard; 6th-in-an-hour rejected politely; no widget on `/tv`). Plus: admin token in zero client bytes; widget is unobtrusive per the design system's tokens (reference `work/design/design-system.md` for colors/type — no new design language).
