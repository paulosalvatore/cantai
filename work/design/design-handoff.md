# cantai — Design Handoff (TICKET-4 → Dev)

- **Date:** 2026-07-05 · **Author:** Designer agent
- **Reference implementation:** `work/design/mockups/` (open `index.html`; `cantai.css` is the token source of truth)
- **Companion docs:** `work/design/design-system.md` (tokens/type/components), `work/design/mvp-scope.md` (build exactly the MVP column)
- **Evidence screenshots:** `work/evidence/ticket-4/` (indexed in `work/reports/design/TICKET-4-design.md`)

## What to build

Four surfaces, in the app the TICKET-1 Dev is building (Next.js App Router):

1. **Patron join** — `/[venue]` (mobile-first)
2. **Patron song pick** — search + paste-link (mobile-first)
3. **Patron queue view** — post-submit home (mobile-first)
4. **`/tv`** — venue screen (1080p landscape, passive)
5. **Admin glance** — mode switcher + queue controls (desktop/tablet)

Port the tokens in `cantai.css` `:root` verbatim (into Tailwind theme config or CSS variables — Dev's call; keep the token NAMES so design and code speak the same language).

## Surface specs

### 1. Patron join (`patron-01-join.html`)

- Layout: single column, 430px max-width, bottom-anchored primary CTA (flex column + `margin-top:auto`).
- Fields: nickname (required, prefill from localStorage on return visits), table number (optional, numeric, narrow field), entry-mode segmented cards.
- Mode selector: two `mode-card`s, radio semantics. Default = 🎤 Cantar. Selected = 2px `--c-pink` border + 10% pink tint.
- CTA "Bora cantar!" — `btn-primary` (stage gradient pill, glow shadow, 52px min-height). Disabled (40% opacity, no glow) until nickname is non-empty.
- Client uuid: generated silently on first load; never shown to the user.
- Venue name shown as a neutral chip in the top bar (from the venue slug).

### 2. Song pick (`patron-02-pick-song.html`)

- Top bar carries identity chips: `🎤 <nick>` (pink sing chip) + `Mesa <n>` (amber chip, only when set).
- One input, dual behavior: free text → YouTube search results; pasted YouTube URL → resolve that video directly (fallback path if search/quota fails — MVP requirement).
- Result row (`song-row`): 64×48 thumbnail, 1-line ellipsized title (15px/700), meta line "channel · duration" (13px, `--c-text-dim`). Selected = 2px pink border + tint + trailing check.
- CTA "Entrar na fila 🎤" enabled only with a selection; secondary "← Voltar" below it.
- Loading state: skeleton rows (surface-2 blocks); Error/quota state: keep the paste-link path working and say so ("Busca indisponível — cola o link do YouTube").

### 3. Patron queue (`patron-03-queue.html`)

- Three stacked zones:
  1. **Now-playing card** — amber-tinted card, "TOCANDO AGORA" label (amber), song title, `🎤 <nick> · Mesa <n>`, mint `AGORA` live chip.
  2. **My-position card** — pink-bordered card with glow: "Você é a 4ª da fila" + song + rough ETA. This is the hero element of the screen; ordinal must gender-match nothing (use the submitted nickname only, ordinal in pt-BR is fine as "4ª/4º" — Dev: use "Nº 4 da fila" if gendering is a pain).
  3. **Queue list** — `queue-row`s: position number, nickname (+ table meta), song, mode chip (🎤 pink / 🎶 neutral). Row states: `playing` (amber left bar 4px + tint, position shows ▶), `mine` (pink left bar + tint, pink position number).
- Bottom CTA "+ Outra música" returns to song pick.
- Updates via polling/SSE (TICKET-0 constraint); no pull-to-refresh needed for MVP.
- Empty state: "Fila vazia — manda a primeira!" + the same CTA.

### 4. `/tv` (`tv.html`)

- All sizes in `vw` (mockup already does) so any TV width works; nothing under ~28px @1080p.
- Layout: top bar (wordmark + venue) · main row (video 1.5fr : meta 1fr) · bottom rail (up-next ×3 + join card).
- Video area: the YouTube IFrame goes where the black panel is (16:9, rounded 1.2vw, subtle pink glow shadow). The `yt-tag` corner label in the mockup is a placeholder — drop it in implementation; YouTube's own branding shows in the player.
- Meta column: amber "TOCANDO AGORA" label → song title `tv-hero` (4.4vw/800) → `🎤 <nick> · Mesa <n>` (2.9vw) → progress bar (stage gradient fill) + times. Progress sync is deferrable (see mvp-scope).
- Up-next rail: max 3 `next-card`s (position pink number, nickname 2vw, song 1.4vw muted, table amber). Listen/dance entries keep the 🎶 marker after the nickname.
- Join card: QR (real QR in implementation — mockup uses a placeholder pattern) + "Escaneia e canta!" + venue URL in amber.
- **Idle state (queue empty — build it):** hide video/meta; center the wordmark + huge "Escaneia e canta! 🎤" + big QR + URL. The idle screen is the venue's recruitment poster.
- Zero interactivity, cursor hidden, no hover states. Auto-advance on video end.

### 5. Admin (`admin.html`)

- Route suggestion: `/[venue]/admin` (auth is out of design scope; TICKET-1/security decide the guard).
- **Mode switcher** — three `mode-option` cards in a row (stack on narrow): name + one-line rule copy (use the mockup copy verbatim — it doubles as the rotation-rule documentation for the bar owner) + `ATIVO` chip on the active one. Switching applies immediately; no confirm (mode changes are reversible).
  - 🎤 Karaokê completo — "Todo mundo entra na fila, ordem de chegada."
  - 🍻 2 por mesa — "No máximo 2 músicas na fila por mesa; a mesa volta quando tocar."
  - 🙋 1 por pessoa — "Cada pessoa mantém 1 música na fila; rodízio justo por identidade."
- Queue panel: same `queue-row` component as patron view + per-row "remover" ghost-danger button (confirm dialog before removing — destructive).
- Controls: ⏸ Pausar / ⏭ Pular música as secondary buttons. Skip advances immediately.
- Right column: three stat cards (queue count tonight, singers, active tables) + join-link card. Stats can be simple counters; no charts.

## Component → state matrix (build checklist)

| Component | default | pressed/focus | disabled | selected/active | error | empty/loading |
|---|---|---|---|---|---|---|
| btn-primary | ✓ | scale .98 + darken | 40% op, no glow | — | — | spinner |
| input | ✓ | pink border | ✓ | — | danger border + helper | — |
| mode-card / mode-option | ✓ | — | — | pink border + tint | — | — |
| song-row | ✓ | tint | — | pink border + check | — | skeleton |
| queue-row | ✓ | — | — | mine / playing variants | — | list empty state |
| TV panels | playing | — | — | — | — | idle/join state |

## Non-negotiables (design acceptance criteria)

1. Token names and hex values from `cantai.css` are used as-is.
2. `/tv` text ≥ 28px @1080p equivalent; patron body text ≥ 16px; touch targets ≥ 48px.
3. One `btn-primary` per patron screen, bottom-anchored.
4. My-row highlight (pink left bar) and now-playing (amber left bar) are visually distinct everywhere the queue renders.
5. pt-BR copy from the mockups verbatim (it's tuned for voice); "cantai" always lowercase.
6. Empty states exist for patron queue, TV idle, and admin queue.
7. Dark theme only; no pure `#000` backgrounds except the video letterbox.

## Open items for the TL (W-design gate)

- Wordmark direction (gradient lowercase, no icon) — approve or redirect.
- pt-BR-only copy for MVP — assumed per Brazilian-market framing; flag if early access should be bilingual.
- Ordinal phrasing on the my-position card ("Você é a 4ª" vs neutral "Nº 4 da fila").
