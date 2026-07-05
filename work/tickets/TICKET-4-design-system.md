# TICKET-4 — cantai design language + MVP mockups

- **Date:** 2026-07-05
- **Product:** cantai
- **Role:** Designer
- **Branch:** `ticket/4-design-system`
- **Status:** IN PROGRESS

## Scope

1. Design language study + design system doc (colors/type/components). Context: bar environment — dark rooms, patrons on phones, `/tv` read from meters away; energetic karaoke vibe, Brazilian warmth; brand name "cantai".
2. MVP-vs-later visual scope.
3. Static-HTML clickable mockups:
   - Patron join + submit flow (nickname + optional table + entry mode sing vs listen/dance; YouTube search/paste).
   - Patron queue view.
   - `/tv` screen (now playing + up next).
   - Venue-admin glance (mode switcher: full karaoke / 2-per-table / one-per-person).
4. Designer's own committed screenshots of the mockups (capture-screenshots skill) as evidence.
5. Design-handoff doc for the Dev.

## Deliverables (paths)

- Mockups: `work/design/mockups/` (self-contained static HTML/CSS, no CDN).
- Docs: `work/design/design-system.md`, `work/design/mvp-scope.md`, `work/design/design-handoff.md`.
- Evidence screenshots: `work/evidence/ticket-4/`.
- Report: `work/reports/design/TICKET-4-design.md`.

## Constraints

- Markdown/HTML/PNG only — TICKET-1 (walking skeleton app) is built in a parallel worktree; do not touch app code.
- No production code; mockups are design artifacts a Dev implements from the handoff.
