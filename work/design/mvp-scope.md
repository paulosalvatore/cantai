# cantai — MVP-vs-later visual scope

- **Ticket:** TICKET-4 · 2026-07-05 · Designer agent

Guard against Dev scope creep: build the MVP column exactly; everything in "Later" is deferred with a reason.

## MVP (ships now)

| Surface / element | Rationale |
|---|---|
| Patron join screen (nickname, optional table, mode selector sing/listen) | Core identity + entry-mode capture; zero-friction onboarding is the product bet. |
| Patron song pick (search field + result rows + paste-YouTube-link fallback) | Core loop; paste fallback keeps v0 alive if search/API quota fails. |
| Patron queue view (my position highlighted, now playing, full queue list) | The core delight moment ("Você é o 4º"). |
| `/tv` now-playing + up-next rail + idle/join state | The venue's whole reason to run cantai; idle QR state recruits patrons. |
| Venue-admin glance: mode switcher (full / 2-per-table / one-per-person) + skip/pause + remove entry | Minimum venue control to survive a real night. |
| Dark theme only, system fonts, stage-gradient CTA | Bar environment; zero asset/font cost. |
| Empty states for queue (patron, TV, admin) | An empty queue is the FIRST thing every venue sees; it must sell, not confuse. |

## Later (explicitly deferred)

| Item | Why deferred |
|---|---|
| Light theme | Bars are dark; no daylight use case yet. |
| Custom display font (rounded) + logo asset | System stack reads fine; brand polish is post-PMF. |
| Queue animations (reorder, confetti on "you're up") | Delight polish; not needed to validate the loop. |
| Patron song history / favorites | Requires persistence beyond session uuid; not core loop. |
| Venue theming / white-label (venue logo, colors) | Pro-plan feature per TICKET-0 monetization. |
| Ads / pro-plan upsell surfaces | Monetization comes after early access. |
| In-app feedback widget UI | Product-defined feedback loop, but its UI can ride an MVP+1 ticket; a simple link suffices at launch. |
| Multi-language (en) | Launch market is BR; pt-BR only. |
| Accessibility pass beyond contrast + touch-target basics (screen-reader flows, reduced-motion) | Contrast/targets are in MVP; full a11y audit is an MVP+1 ticket. |
| TV progress bar synced to actual video time | Mockup shows it; Dev may ship a static placeholder if IFrame time polling is nontrivial in TICKET-1. |
