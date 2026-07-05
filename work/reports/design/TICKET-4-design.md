# Designer report — TICKET-4 (cantai design language + MVP mockups)

- **Date:** 2026-07-05 · **Role:** Designer · **Branch:** `ticket/4-design-system` · **PR:** #2
- **Worktree:** `/Users/paulosalvatore/Documents/GitHub/cantai/.worktrees/ticket-4` · **Review port:** 3004 (`3000 + ticket#` convention; serve stopped after capture)

## Status: COMPLETE (awaiting W-design TL gate)

## Deliverables

| Artifact | Path |
|---|---|
| Design system (tokens/type/components/voice) | `work/design/design-system.md` |
| MVP-vs-later visual scope | `work/design/mvp-scope.md` |
| Design handoff (Dev-buildable) | `work/design/design-handoff.md` |
| Clickable mockups (static HTML/CSS, no CDN, no JS) | `work/design/mockups/` — `index.html`, `cantai.css`, `patron-01-join.html`, `patron-02-pick-song.html`, `patron-03-queue.html`, `tv.html`, `admin.html` |
| Evidence screenshots (Designer-captured) | `work/evidence/ticket-4/` |
| Ticket file | `work/tickets/TICKET-4-design-system.md` |

## Key design decisions (made autonomously, TL to ratify at the gate)

1. **"Palco de bar" direction:** neon raspberry `#FF3D71` + warm amber `#FFC24B` over near-black plum `#0D0A14`; the pink→amber **stage gradient** is the brand element (wordmark, primary CTA, now-playing accents). Warm-neon, not cyberpunk-cold — Brazilian sunset meets karaoke spotlight.
2. **pt-BR-only, party-host voice** ("Bora cantar!", "Manda tua música") — launch market is BR; flagged in the handoff for TL to redirect if early access should be bilingual.
3. **Dark theme only** for MVP (bars are dark rooms).
4. **System font stack** (zero font cost); rounded display face deferred to post-MVP.
5. **10-foot rules for `/tv`:** all sizes in `vw`, nothing under ~28px @1080p, passive screen, idle state doubles as a QR recruitment poster.
6. **Semantic accent split:** pink = you/sing/primary action; amber = now-playing/venue warmth; mint = live/success — so "your row" and "playing row" never collide visually.

## Screenshot index (D-014 analysis)

All under `work/evidence/ticket-4/`:

| File | Viewport | What it shows / proves |
|---|---|---|
| `mockups-00-index-hub.png` | 1280×720 | Mockup hub with the 5 screens + clickable-flow map — entry point for TL/Reviewer. |
| `patron-01-join-mobile.png` | 390×844 | Join screen: nickname, optional table, mode selector (🎤 Cantar selected — pink border+tint), bottom-anchored stage-gradient CTA. Proves one-thumb layout + selected-state styling. |
| `patron-02-pick-song-mobile.png` | 390×844 | Search input with results; first result selected (pink border + check); identity chips (🎤 Marina, Mesa 7) in top bar; CTA + back. Proves song-row states and chip system. |
| `patron-03-queue-mobile.png` | 390×844 | Now-playing card (amber, AGORA mint chip), hero "Você é a 4ª da fila" card (pink glow), queue list with `playing` (amber left bar, ▶) and `mine` (pink left bar) row variants, mode chips. Proves the core delight moment reads instantly. |
| `tv-01-now-playing-1080p.png` | 1920×1080 | /tv: video placeholder left, TOCANDO AGORA + 88px-equivalent hero title + singer/table right, gradient progress bar, A SEGUIR rail (3 next + table badges), QR join card. Proves meters-away legibility hierarchy. |
| `admin-01-glance-desktop.png` | 1280×800 | Admin glance: 3-mode switcher (Karaokê completo ATIVO, 2 por mesa, 1 por pessoa — each with its rotation rule as copy), queue with AGORA + remove actions, Pausar/Pular controls, night stats, join-link card. Proves the mode switcher is glanceable and self-documenting. |

Console/network: zero errors across all captures (checked during capture run).

## Capture notes / friction

- **Playwright MCP browser was locked by a parallel agent** (`Browser is already in use for …ms-playwright-mcp…` — TICKET-1 Dev runs in parallel). Fallback: installed `playwright` in the session scratchpad and captured via a headless-chromium script against the sanctioned `serve-for-review.sh` serve (background, port 3004, stopped after capture). Same contract (background serve, absolute EVIDENCE_DIR, committed evidence); flagging the MCP single-profile lock as W6 friction — parallel fleets need `--isolated` or per-agent profiles.
- One visual defect caught in self-review: up-next card #3 on /tv overflowed ("DJ Formiga 🎶" over the table badge). Fixed (`flex: 1 1 auto; min-width: 0` + ellipsis on `.who`) and recaptured — long nicknames now truncate cleanly.

## Open items for the TL (W-design gate)

- Approve/redirect the wordmark treatment (gradient lowercase, no icon asset in MVP).
- pt-BR-only copy for early access — confirm.
- Ordinal phrasing "Você é a 4ª" vs neutral "Nº 4 da fila".
