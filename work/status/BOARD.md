# cantai — Board

_Last updated: 2026-07-05 (PR #3 merged; PR #4 security-fix round)_

## Notes

- Branch protection on `main`: SKIPPED — GitHub Free + private repo (403); gates are process-enforced (D-011).

## Tickets

| Ticket | Title | Status | Notes |
|---|---|---|---|
| TICKET-0 | Bootstrap | DONE | Repo created 2026-07-05; definition in work/tickets/TICKET-0-bootstrap.md |
| TICKET-1 | Walking skeleton / prototype core | IN PROGRESS | Dev (sonnet) on .worktrees/ticket-1, port 3040; join→submit→queue→/tv autoplay |
| TICKET-2 | Deploy pipeline (Vercel) | UNBLOCKED (queued) | TL connected vercel.com/paulosalvatores-projects/cantai; runs after PR #4 merges |
| TICKET-3 | Rotation/fairness engine lib | DONE | PR #3 merged: sonnet+opus APPROVE; opus caught real peek≠play starvation bug pre-merge; 47/47 tests |
| TICKET-4 | Design language + mockups | DONE | PR #2 merged, TL-ratified |
| TICKET-5 | Roadmap + specs (modes/feedback/monetization) | DONE | PR #1 merged (Reviewer APPROVE after B1/B2 fixes; opus-skip recorded, docs-only) |
| TICKET-19 | PMF wave ticket batch | IN PROGRESS | PO (fable) writing buildable tickets 6-12+18 with ownership boundaries |
| TICKET-1 | (gates) | SECURITY-FIX ROUND | App Tester PASS; Security PASS-WITH-NOTES; Dev fixing 4 MEDIUMs pre-merge (public deploy on merge); then review chain |
| TICKET-18 | TV mode: bigger type + fullscreen | UP NEXT | TL follow-up on design ratification (prompt 004); numbered past PO backlog #6–#17 |
