# TICKET-18 — TV mode: bigger type + fullscreen

- **Date:** 2026-07-05 · **Product:** cantai · **Author:** Product Owner (TICKET-19 batch; ticket originated as a TL follow-up on design ratification — prompt 004)
- **Wave:** 1 (no cross-deps; launch at PR #4 merge — sole owner of `/tv`)
- **Depends on:** TICKET-1 merged; design system merged (`work/design/`). Blocks: nothing (TICKET-7 lands its small pause-state read on `/tv` after this merges).
- **Sizing:** S

## Goal

The TV screen reads from across a noisy bar and runs chrome-free: bigger type per the ratified design system's TV scale, plus a proper fullscreen mode. The TV is also the venue's recruitment poster (idle state + QR), so its polish is disproportionately valuable.

## Design source (build exactly this)

`work/design/design-handoff.md` §4 `/tv` (`work/design/mockups/tv.html`) + `work/design/design-system.md` TV type scale:

- All sizes in `vw`; nothing under ~28px @1080p; `tv-hero` 4.4vw/800 for the song title; nickname/table 2.9vw; up-next rail cards (position pink number, nickname 2vw, song 1.4vw muted, table amber).
- Layout: top bar (wordmark + venue) · main row (video 1.5fr : meta 1fr) · bottom rail (up-next ×3 + join card).
- Idle state (queue empty): hide video/meta; centered wordmark + huge "Escaneia e canta! 🎤" + big QR placeholder + URL. (Real QR arrives with TICKET-9; render the join URL prominently until then.)
- Zero interactivity, cursor hidden, no hover states, auto-advance on end.

## Fullscreen (this ticket's calls)

- One explicit "entrar em tela cheia" affordance on `/tv` (browser Fullscreen API requires a user gesture — a single subtle button/keypress `F`, hidden after entering).
- In fullscreen: hide every remaining browser-ish affordance, keep cursor hidden, exit via `Esc` (native).
- Wake-lock (`navigator.wakeLock`) request while on `/tv` so the venue screen never sleeps mid-night (progressive enhancement — ignore where unsupported).
- Survive tab reloads: re-show the fullscreen affordance (can't re-enter without a gesture — accepted platform limit).

## Also fold in (one-line scope transfers)

- The **"powered by cantai" + QR/join footer with a config flag (default on)** from the monetization spec AC4 — it's a TV-surface concern and this ticket owns the file (flag env-driven, no UI to toggle it yet).

## Scope — in

TV page restyle to the design-system TV scale, fullscreen mode + wake lock, idle/recruitment state per mockup, the footer flag above, updated TV evidence screenshots (capture-screenshots path), e2e smoke: idle state renders; entry plays with the new layout.

## Scope — out

Progress-bar sync (deferrable per mvp-scope), pause-state UI (TICKET-7 adds its read after this merges), real QR (#9), rotation-aware up-next ordering (#10 — rail shows store order until then).

## File ownership (parallel-dev boundaries)

- **Owns:** `app/tv/**` (sole owner during wave 1), TV-scoped styles (its own CSS module or the tv section of `app/globals.css` — additive, clearly-fenced block), `components/tv/**` (new), its e2e + evidence.
- **Must not touch:** `app/page.tsx`, `app/api/**`, `lib/**`, `packages/rotation-engine/**`, `app/layout.tsx`.

## Acceptance criteria

1. At 1920×1080, song title renders at the design system's hero scale and no text on `/tv` is under ~28px (evidence screenshot at 1080p).
2. The fullscreen affordance enters true fullscreen on click/keypress, then hides; `Esc` exits cleanly; cursor stays hidden on `/tv`.
3. Idle state matches the mockup: wordmark + call-to-action + join info, no dead video panel.
4. Auto-advance and skip behavior unchanged (regression e2e passes).
5. `POWERED_BY_FOOTER` flag (default on) renders the footer; off removes it without rebuild artifacts elsewhere.
6. Wake lock requested on supported browsers; no error thrown where unsupported.
