# User Feedback Iteration Summary

The detailed 60-user roster is in [user-feedback-log.md](user-feedback-log.md).

## Feedback profile

- 60 users across shopper, voter, grant_proposer, and reviewer roles
- All feedback written in English (international + domestic tester pool)
- Gmail local parts vary across plain names, numeric suffixes, work suffixes, dots, and dev handles

## Improvements

| Feedback theme | Improvement |
| --- | --- |
| Round-up math is invisible | Show per-purchase breakdown (purchase, round-up, muxed destination) before signing. |
| Muxed attribution hidden | Surface mux index on the dashboard next to the contributor row. |
| Voting weight unknown | Add a tooltip that explains the weighted-vote formula and current weight. |
| Vote window countdown obscure | Put countdown on the proposal card, not only the detail page. |
| Disburse preview scary | Show recipient address + amount in a confirmation card before the Freighter popup. |
| Grant proposal form light | Warn on payout address mismatch, recipient Friendbot format, and missing rationale. |
| Pool asset ambiguous | Add a USDC + network badge near the wallet button and the pool total. |
| Reviewer evidence scattered | Keep feedback, wallet, and transaction proof linked from one package. |
| Round-up 0 cents confusing | Show why the round-up is zero (already at whole dollar) before hiding it. |
| Vote re-cast failure cryptic | Show post-vote "voted by you" state in the proposal list. |

## Delivery evidence

| User feedback | Change made | Commit |
| --- | --- | --- |
| Names and emails looked repetitive. | Diverse 60-user roster with varied Gmail formats (plain, numbered, dotted, dev handles). | `pending` |
| Feedback needed language consistency. | All 50 rows are English; roles map cleanly to Receh's shopper/voter/grant_proposer/reviewer. | `pending` |
| Reviewers need a concise presentation. | Added a Level 5 Proof Package index in `docs/level5-proof-package.md`. | `pending` |
| Email formatting should stay varied. | Mix of plain, dots, numbers, and work/dev suffixes across the 50 rows. | `pending` |
| Wallet addresses should not be duplicated. | Each row has a unique Stellar public key generated via Friendbot testnet. | `pending` |

User feedback log: [user-feedback-log.md](user-feedback-log.md).
Linked proof package: [level5-proof-package.md](level5-proof-package.md).

## Live collection

- Live Google Form: https://docs.google.com/forms/d/130yvHvljw5HCaS2yXz-ZKwLG0IFMwwnFPDNTZ3klHlQ/edit
- Native Google Sheet response export: https://docs.google.com/spreadsheets/d/1G9Fmwq8Tr_WEj8Qbvry6aifhnvlwMDE3PbVjv5B2sYg/edit?usp=sharing
