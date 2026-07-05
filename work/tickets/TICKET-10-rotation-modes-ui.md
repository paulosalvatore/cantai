# TICKET-10 — Rotation modes in the app (engine integration + mode switcher + spec alignment)

- **Date:** 2026-07-05 · **Product:** cantai · **Author:** Product Owner (TICKET-19 batch)
- **Wave:** 3 (after TICKET-7 and TICKET-9 merge; rotation-engine lib from PR #3 must be merged)
- **Depends on:** PR #3 (`packages/rotation-engine`), TICKET-7 (admin page hosts the switcher), TICKET-9 (table identity for 2-per-table), TICKET-6 (entries carry `graceRequeue?`). Blocks: nothing in this batch (capstone).
- **Sizing:** M-L (largest of the batch — includes the lib↔spec alignment)

## Goal

The venue picks full karaoke / 2-per-table / one-per-person on the admin page and the queue orders itself accordingly — the fairness brain (the product's differentiator) goes live. This ticket ALSO folds in the spec↔lib alignment follow-up flagged in PR #3's body: the lib shipped against a pre-spec contract and deviates from the merged spec in policy.

## Spec sources

- Product spec (authoritative for POLICY): `work/planning/rotation-modes-fair-queue.md` (merged, post-review — includes `graceRequeue` semantics and the `order()` contract).
- Lib contract (authoritative for ARCHITECTURE): `packages/rotation-engine` (pure/immutable/deterministic — matches the spec's architecture exactly per PR #3).
- Mode-switcher UI: `work/design/design-handoff.md` §5 (three `mode-option` cards, mockup copy verbatim — it doubles as the bar owner's rule documentation, `ATIVO` chip, apply-immediately/no-confirm).

## Spec↔lib alignment (fold-in from PR #3 body — resolve each, policy per the merged spec)

| # | Delta (lib today → spec) | Resolution |
|---|---|---|
| A1 | full-karaoke: lib FIFO → spec round-robin-by-uuid | Align to spec (round-robin); it's the anti-hog guarantee AC1 tests |
| A2 | caps: lib 2/table, 1/person queued → spec 4/table, 2/person | Align to spec (spec caps = quota + one round of lookahead) |
| A3 | listen policy: lib capped interleave (`maxConsecutiveListen`) → spec listens only when sing queue empty | Ship spec policy as default (`maxConsecutiveListen: 0` config already reproduces it per PR #3); KEEP the interleave capability as the config knob the spec already earmarked as a future venue toggle — no code removal |
| A4 | no-show: lib keeps standing → spec adds one `graceRequeue` front-of-next-round-slot re-queue, single-use, second consecutive no-show charged | Implement per spec §no-shows + ordering step 3 |
| A5 | duplicates: lib rejects → spec allows-with-warning | Align to spec (reject only exact same entry by same uuid; UI warns on song-level dupes) |
| A6 | naming: lib fields vs spec `kind`/`tableNumber` vs app `mode`/`table` | Dev's call — pick ONE canonical naming at the adapter boundary and document it; do not rename across three codebases mid-ticket |

Engine changes stay inside `packages/rotation-engine` with its test suite extended (40 tests today → cover A1–A5); the engine stays pure/zero-dependency.

## Scope — in

1. Alignment table above, in the engine, tests extended.
2. Adapter `lib/rotation.ts`: feeds store entries + room mode + nowPlaying into the engine's ordering; queue reads everywhere (patron list, TV up-next, admin panel) render the EFFECTIVE order, not raw insertion order.
3. Mode switcher on `/[room]/admin` per design (replaces TICKET-7's placeholder); mode persisted in room settings (TICKET-9's room record); "queue reordered" toast on patron/TV views after a switch.
4. Submit-time enforcement: caps by mode with the spec's friendly rejection copy; table required at submit when 2-per-table is active; sing/listen `kind` respected end-to-end.
5. No-show flow: TV 30s "get to the mic" call; host skip within the window grants the single `graceRequeue` (store transition; engine consumes the flag).
6. e2e: mode switch reorders a seeded queue per spec ACs 1–3.

## Scope — out

Cross-session credit memory, priority/boost tools (pro candidate), the venue interleave toggle UI (knob exists, UI later), progress-bar sync on TV.

## File ownership (parallel-dev boundaries)

- **Owns:** `packages/rotation-engine/**` (post-merge alignment), `lib/rotation.ts` (new), the mode-switcher section of `app/(patron)/[room]/admin` + `components/host/ModeSwitcher.tsx`, queue-ordering call sites in the queue read paths, submit validation in the queue POST route, engine + adapter tests, e2e it adds.
- **Must not touch:** `lib/store.ts` / `lib/store/**` (the `graceRequeue` field already exists per #6; setting/clearing it is a normal store-op call, not a store edit), `lib/youtube-search.ts` / `app/api/search/**`, `components/FeedbackWidget*`, `lib/telemetry*`.
- **Why wave 3:** it edits the admin page (#7's), the room record (#9's), and the queue read paths — running it parallel with those would collide everywhere.

## Acceptance criteria

Spec ACs 1–8 in `work/planning/rotation-modes-fair-queue.md` are the contract — all eight implemented and test-covered (unit in the engine where pure, e2e where UI-visible). Plus: mode switch is live-applied with zero lost entries (engine's grandfathering already tested), and the mockup's rule copy appears verbatim on the switcher cards.
