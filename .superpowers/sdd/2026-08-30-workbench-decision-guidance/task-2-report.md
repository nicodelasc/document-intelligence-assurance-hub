# Task 2 report: Workbench interaction redesign

## Implementation summary

- Added a cobalt `How it works` trigger using the shared `Button` and shared `Dialog`. The dialog has the required five ordered steps, deterministic-evidence and simulation guidance plus a visible Close action. Dialog mouse close, Escape close and trigger focus restoration use the existing primitive.
- Added `AssuranceTrace` with a stable controlled disclosure. The trace remains expanded while idle or processing, collapses only in the successful submit branch with `3 of 3 stages completed` and duration text, stays expanded after failure and resets at actual new-run start. The outcome heading remains the post-run focus target and the existing polite live region remains the only status announcement path.
- Replaced the separate outcome, differences and controls panels with `Decision and next steps`. Its order is verified outcome, decision brief, evidence differences and workflow controls. Evidence ledger and Activity timeline remain separate panels below it.
- Hydrated the persisted `details.result.documentClassification` tolerantly. `WorkflowPanel` now passes it to `allowedWorkflowActionsForRun`, so irrelevant and uncertain runs expose only replace and download controls. Guarded classifications suppress a hostile persisted proposal and render the fixed server-owned brief.
- Added mobile stacking and wrap styles for the trace disclosure, decision sections and guidance dialog content.

## Files changed

- `src/components/workbench/assurance-trace.tsx` (new)
- `src/components/workbench/how-it-works-dialog.tsx` (new)
- `src/components/workbench/workbench-view.tsx`
- `src/components/workbench/workflow-panel.tsx`
- `src/app/globals.css`
- `tests/component/workbench.test.tsx`

## TDD evidence

### RED

`npm test -- tests/component/workbench.test.tsx` initially ran 67 tests with 7 expected failures:

- missing combined Decision and next steps panel
- missing How it works dialog
- missing success trace disclosure and summary
- missing failed trace disclosure and toggle
- missing next-run trace reset behavior
- irrelevant controls were unguarded
- uncertain controls were unguarded

After those behaviors were green, the added hostile persisted-proposal test produced the expected single RED failure: the decision brief rendered `Hostile provider proposal` instead of the fixed server-owned guarded brief.

### GREEN

- `npm test -- tests/component/workbench.test.tsx`: 1 file passed, 68 tests passed.
- `npm test`: 46 files passed, 548 tests passed.
- `npm run lint`: exit 0.
- `npm run typecheck`: exit 0.
- `git diff --check`: exit 0. Git printed only expected line-ending conversion warnings.

## Self-review and concerns

- The shared Dialog retains its established inert backdrop, scroll lock, keyboard trap and focus restoration. No browser alert, confirm or prompt API was introduced.
- The trace disclosure neither moves focus nor writes an additional live-region announcement during completion. The existing outcome-heading effect remains the focus winner.
- No live provider credentials or provider routes were read or changed.
- Component, lint and type tests passed. A separate browser screenshot pass for 390 px mobile layout and reduced-motion styling was not run in this task.
