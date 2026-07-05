# cantai — Design System (v1)

- **Ticket:** TICKET-4
- **Date:** 2026-07-05
- **Author:** Designer agent
- **Status:** Proposed (awaiting W-design TL gate)

## 1. Design language study

### Context constraints (these drive every decision)

| Constraint | Consequence |
|---|---|
| Bars are dark rooms | Dark-first UI, no light theme in MVP. Deep near-black plum background, never pure black (avoids OLED smearing and harsh edge glow on cheap TVs). |
| Patrons use their own phones, one-handed, possibly a few drinks in | Mobile-first, big touch targets (min 48px), one primary action per screen, zero signup friction, generous type (16px+ body). |
| `/tv` is read from meters away | 10-foot UI rules: massive type (title ≥ 72px at 1080p), contrast ≥ 7:1, no hover states, no dense text, information hierarchy readable in one glance. |
| Karaoke = energy, party, spotlight | Neon-warm accents, a "stage gradient" brand element, playful copy. |
| Brazilian warmth, name is "cantai" | pt-BR copy voice ("Bora cantar!"), warm amber alongside the neon pink — sunset, not cyberpunk-cold. |

### Brand direction: "palco de bar" (bar stage)

The name **cantai** reads as the Brazilian-northeastern plural imperative "sing, y'all!" — collective, informal, warm. The visual language pairs a **neon raspberry pink** (the karaoke spotlight / neon sign) with a **warm amber** (Brazilian sunset / bar lighting) over a **deep plum-black**. The two accents meet in the brand **stage gradient** (pink → amber), used for the logo wordmark, primary CTAs, and the now-playing highlight. Success/live states use a **neon mint** so "you're up / live" never competes with the brand accents.

Logo treatment (MVP): lowercase wordmark `cantai` with the stage gradient + a mic-tilde flourish. No icon asset needed for MVP; the wordmark is the mark.

## 2. Color tokens

All colors defined as CSS custom properties (`work/design/mockups/cantai.css` is the reference implementation).

| Token | Hex | Use |
|---|---|---|
| `--c-bg` | `#0D0A14` | App/TV background (near-black plum) |
| `--c-surface` | `#1A1424` | Cards, sheets |
| `--c-surface-2` | `#251C33` | Elevated cards, inputs, list rows |
| `--c-border` | `#372B4A` | Hairlines, input borders |
| `--c-pink` | `#FF3D71` | Primary accent — CTAs, active states, "sing" mode |
| `--c-pink-deep` | `#C4285A` | Pressed state of primary |
| `--c-amber` | `#FFC24B` | Secondary accent — highlights, "now playing", warmth |
| `--c-mint` | `#2EE6A8` | Success, live indicator, "you're up" |
| `--c-text` | `#F7F3FC` | Primary text |
| `--c-text-muted` | `#A79BC0` | Secondary text, labels |
| `--c-text-dim` | `#6E6288` | Tertiary/meta text |
| `--c-danger` | `#FF5C5C` | Destructive (remove from queue) |
| `--g-stage` | `linear-gradient(135deg, #FF3D71, #FFC24B)` | Brand gradient — wordmark, primary CTA, now-playing edge |

Contrast checks (against `--c-bg`): `--c-text` 16.9:1, `--c-amber` 11.5:1, `--c-pink` 5.6:1 (accent/large text only, never body copy), `--c-mint` 11.2:1. TV surfaces use `--c-text` and `--c-amber` for anything that must be read at distance.

## 3. Typography

System font stack for MVP — zero font-loading cost, fine on phones and TVs:

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
```

Later (post-MVP): a rounded display face (e.g. Baloo 2 / Nunito) for the wordmark and TV headings, self-hosted.

### Scale — phone (patron surfaces)

| Role | Size / weight | Use |
|---|---|---|
| `display` | 32px / 800 | Screen title ("Bora cantar!") |
| `title` | 22px / 700 | Card titles, song names |
| `body` | 16px / 400 | Default text |
| `label` | 13px / 600 uppercase, letter-spacing 0.08em | Field labels, section headers |
| `meta` | 13px / 400 | Timestamps, hints |

### Scale — TV (1080p reference, scale with `vw` in implementation)

| Role | Size / weight | Use |
|---|---|---|
| `tv-hero` | 88px / 800 | Now-playing song title |
| `tv-singer` | 56px / 700 | Singer nickname |
| `tv-next` | 40px / 700 | Up-next entries |
| `tv-meta` | 28px / 600 | Labels ("A SEGUIR", table numbers) |

Rule: nothing on `/tv` below 28px equivalent. Implementation should use `clamp()`/`vw` units so a 720p bar TV still reads.

## 4. Spacing, radius, elevation

- Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48 (px). Phone screens use 16px gutters; TV uses 48px+ gutters.
- Radius: `--r-card` 16px (cards/sheets), `--r-control` 12px (inputs/secondary buttons), `--r-pill` 999px (primary CTA, chips/badges).
- Elevation: flat design + 1px `--c-border` hairlines; the ONLY glow is the stage gradient's soft shadow on the primary CTA and the now-playing card (`box-shadow: 0 0 24px rgba(255,61,113,.35)`), reinforcing "spotlight".

## 5. Component inventory (MVP)

| Component | States | Notes |
|---|---|---|
| **Primary button** (pill, stage gradient) | default / pressed (`--c-pink-deep` overlay) / disabled (40% opacity, no glow) / loading (spinner, label kept) | One per screen max. Min height 52px. |
| **Secondary button** (outline, `--c-border`, text `--c-text`) | default / pressed / disabled | |
| **Text input** (surface-2 fill, border hairline) | default / focus (`--c-pink` border) / error (`--c-danger` border + 13px helper) / disabled | 52px height; 16px font (prevents iOS zoom). |
| **Mode selector** (segmented cards: 🎤 Cantar / 🎶 Só curtir) | unselected / selected (pink border + tint) | Radio semantics; big tap area (~half screen width each). |
| **Chip / badge** | mode badge (🎤 pink-tint / 🎶 surface), table badge (amber-tint, "Mesa 7"), live badge (mint dot + "AGORA") | Pill radius, 13px/600. |
| **Song result row** | default / selected (pink border) / pressed | Thumbnail 64×48 (16:9), title 1-line ellipsis, channel + duration meta. |
| **Queue row** | default / **mine** (pink left-edge bar + tint) / now-playing (amber left-edge + tint) | Position number, nickname, song, badges. |
| **Now-playing card (patron)** | playing / idle-empty ("Fila vazia — manda a primeira!") | Amber accents. |
| **TV now-playing panel** | playing / idle (QR + join CTA fullscreen) | Video area 16:9 left, meta right; see mockup. |
| **TV up-next rail** | 1–3 entries / empty | Bottom strip, numbered. |
| **Admin mode switcher** | 3 options, one active | Cards with title + one-line explanation of the rotation rule. |
| **Toast** | success (mint) / error (danger) | Phone only, bottom, 3s. |
| **Empty states** | queue-empty (patron, TV, admin) | Always an action, never a dead end. |

## 6. Interaction patterns

- **One-thumb flow:** join → pick song → in queue is 3 screens, each with a single bottom-anchored primary CTA.
- **No signup:** nickname + auto client uuid; table number optional; mode defaults to 🎤 Cantar.
- **Queue feedback:** after submit, patron lands on the queue view with THEIR row highlighted + position ("Você é o 4º"). This is the core delight moment — make position unmistakable.
- **TV is passive:** zero interaction on `/tv`. Auto-advance; idle state shows a join QR/URL so the screen itself recruits patrons.
- **Admin is a glance:** mode switch + skip/pause reachable in ≤ 2 taps; destructive actions (remove entry) need a confirm.
- **Motion (post-MVP noted, MVP minimal):** MVP ships only CSS transitions on press/selection (120ms). Queue reorder/confetti animations deferred.

## 7. Voice & copy (pt-BR)

Informal, warm, party-host energy. Examples used in mockups: "Bora cantar!", "Como você quer entrar?", "Manda tua música", "Você é o 4º da fila 🔥", "A SEGUIR", "Fila vazia — manda a primeira!". Never corporate ("submeter", "usuário"). Keep "cantai" always lowercase.
