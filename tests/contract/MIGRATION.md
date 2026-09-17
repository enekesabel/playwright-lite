# Contract-test migration ledger

One row per legacy test. Outcomes: `moved -> <new file>`, `split -> <new files>`,
`deleted, duplicate of <baseline id>`, `left for M2 (<rule>)`. Removed by the
final migration ticket.

| legacy file            | describe path > title                                                                                      | outcome                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `src/contract.test.ts` | Single-document adapter contract > common locator queries > aborts every action with a prefixed AbortError | moved -> `tests/contract/rules/cancellation.test.ts` |
