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

## Fix round 1: classification hydration and replacement trace reset

### Implementation summary

- Added a `controlsAvailable` gate to `WorkflowPanel`. `WorkbenchView` opens that gate only after action-detail hydration is ready with a verified document classification. Workflow controls are therefore absent during detail loading and remain absent when detail loading fails or returns no valid classification.
- Preserved the server allowlist. Once hydration verifies an irrelevant or uncertain classification the existing guarded control group remains the only available group. A verified supplier invoice restores only the controls that the server policy allows for its status and outcome.
- Reset the assurance trace with the active workflow during replacement. Replacement now clears terminal status and elapsed duration while restoring the idle trace to its default expanded state.

### Regression TDD evidence

#### RED

Command:

```text
npm test -- tests/component/workbench.test.tsx
```

Output:

```text
Test Files  1 failed (1)
     Tests  2 failed | 66 passed (68)
```

The action-detail loading regression found four ordinary controls when zero were expected. The replacement regression found the completed assurance-trace disclosure still present after replacement. Both failures were expected before the production change.

#### GREEN

Focused command:

```text
npm test -- tests/component/workbench.test.tsx
```

Output:

```text
Test Files  1 passed (1)
     Tests  68 passed (68)
```

Type command:

```text
npm run typecheck
```

Output:

```text
> typecheck
> tsc --noEmit && tsc --project tests/tsconfig.contract.json
```

Full command:

```text
npm test
```

Output:

```text
Test Files  46 passed (46)
     Tests  548 passed (548)
```

`git diff --check` passed with only the repository's expected line-ending warnings.

### Covering tests

- `shows honest action-detail loading then a recoverable failure` proves controls are hidden during a successful detail-loading window and after a detail failure then appear only when retry returns a verified supplier-invoice classification.
- `marks the active grouped stage failed after a terminal failure` and `sends custom preflight metadata with a failed terminal event` prove unverified failed details fail closed.
- The guarded irrelevant and uncertain classification matrix continues to prove the settled guarded allowlist.
- `persists replacement intent then opens the native picker without processing` proves replacement removes the terminal trace and returns the idle trace state without disturbing the outcome focus behavior.

### Self-review and concerns

- The client change does not alter capability tokens, workflow-action requests or server authorization.
- The new gate hides every workflow action until classification is verified. This intentionally means a transient or permanent detail failure exposes no retry or download controls.
- No live provider credentials were read and no provider calls were made. No browser visual pass was run for this focused fix round.
