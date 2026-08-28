# Task 4 report: Workbench interaction redesign

## Outcome

The Workbench now presents three operational source cards followed by a real `+ Add your document` button. The button opens the existing native file input and keeps drag-and-drop, validation, first-error focus and consent behavior intact.

The model control is one grouped native select sourced from `/api/models`. Every run submits its provider and model. Demo results remain explicitly independent from that configuration. The one demo notice near the run action is `Demo data — no provider call`.

The assurance rail now maps raw workflow activity into `Understand document`, `Verify evidence` and `Resolve and prepare action`. Publishing is excluded. Completed runs show the prepared action before the evidence ledger. Ready actions use pessimistic staging with duplicate protection and retry after failure.

The request boundary and recorded provider now use `syntheticFixtures` directly. No temporary legacy fixture mapping was added. Invoice document evidence is separate from trusted reference data so its review outcome comes from a deterministic amount conflict.

## Red evidence

- The first trace unit run failed because `trace-model.ts` did not exist.
- The model selector, upload tile and action-state component assertions failed against the legacy provider radios and source controls.
- The first operational route and provider run failed because multipart parsing and recorded-provider selection still required legacy invoice IDs.
- The first invoice browser run returned `Clear` even though the fixture required review. Focused fixture and route tests then failed because `documentData` was absent and the completed outcome was `clear`.
- The first accessibility run failed on desktop and mobile because the new document-instruction label measured 4.41:1 against its soft warning background.
- The first React lint run rejected a synchronous state reset inside the action-card effect.
- The first recorded-comparison boundary test exposed selected model names beside deterministic results.

## Green evidence

- Pure trace tests pass with three visible groups and publishing excluded: 2 tests.
- Prepared-action component tests pass for pessimistic pending state, duplicate clicks and retry: 3 tests.
- Focused operational route and provider tests pass with the three new fixture IDs and action-aware output.
- The invoice fixture regression passes with document total `1250.00 SGD`, trusted register total `1200.00 SGD` and outcome `needs_review`.
- The focused Workbench and accessibility browser command passes: 7 tests.
- The full browser suite passes: 17 tests.
- The full Vitest suite passes: 38 files and 322 tests.
- ESLint passes.
- TypeScript application and contract checks pass.
- Premium audit passes with no findings.
- Design lint passes with zero errors. It reports nine pre-existing orphaned-token warnings.

## Accessibility and responsive verification

Axe reported no serious or critical violations on Workbench and Operations at 1536 by 1024 and 390 by 844. The warning color token was darkened to `#A14F00` after the failed contrast run.

The mobile browser check measured the source heading before document preview before assurance trace. The page had no horizontal document overflow at 390 px. The grouped select and upload button remained visible. Desktop retained the three-region evidence-desk composition.

The rendered interaction check confirmed the Workbench title, meaningful page content and no framework overlay. The only development console entry was the known Next development-mode `eval()` warning under the repository CSP. No relevant application warning or error remained. After a warehouse run settled the panel order was Assurance trace then Prepared action then Evidence ledger. The deterministic rail did not contain the selected Claude model name.

## Self-review

- The trace mapper is pure and owns no rendering state.
- The native select preserves platform popup geometry.
- Runtime CSS remains the owner of layout and color tokens. `DESIGN.md` owns the matching canonical values.
- Action staging changes visible state only after a successful server response.
- A repeated click while staging is disabled and the server route remains idempotent.
- Failure leaves the proposal intact and exposes the same safe action for retry.
- Recorded comparisons show `Not called (demo)` instead of a selected model name.
- Public prototype and replay labels were removed from UI-capable source paths.
- Updated verification images cover desktop and reduced-motion mobile layouts.
- No API key was read or used.

## Concerns

- Browser automation covers Chromium only.
- Design lint still reports nine existing orphaned-token warnings but no error.
- Development rendering reports the expected Next CSP `eval()` warning. React does not use that development behavior in production.
- Live-provider acceptance remains outside this keyless task.

## Fix round 1/5: six Important findings

### Outcome

Operations now renders `Not called (demo)` for both provider and model call fields on deterministic runs. Its provider split counts only live-run configuration while benchmark coverage remains separate.

Ready and review-required proposals can stage. Blocked proposals cannot. The stage mutation requires the browser-held run capability in the `x-run-capability` request header. The server rate-limits first then verifies the capability against the stored deletion-token hash before any mutation. Missing and invalid capabilities return the same safe authorization error. The capability never enters a URL or log.

The Workbench announces only `Understand document`, `Verify evidence` and `Resolve and prepare action`. Repeated raw events inside one group do not repeat the announcement and publishing remains hidden. Terminal failure marks the active visible group as needing attention and clears active state.

Completion now ends cancellation before prepared-action detail loading starts. Loading no longer appears as an absent action. Detail failure exposes safe recovery and retry. Cancellation is guarded independently from render timing and cannot clear one result region while leaving another stale region visible.

Fixture controls, upload activation, custom inputs and the native model select remain disabled during validation and execution. A late model-catalog response cannot change the disabled configuration. The preview and submitted configuration therefore remain aligned for the active attempt.

### Red evidence

- The Operations component test initially found `openai` in a demo row and the metrics test received `{ openai: 1, anthropic: 0 }` after one deterministic run.
- The review-required action test found only a disabled `Review required` button instead of an enabled `Stage action` control.
- The grouped trace tests initially had no announcement or failure-settlement functions. The failure component test left `Resolve and prepare action` marked `In progress`.
- The lifecycle tests initially found mutable fixture controls and `No action available` while action detail was pending. Cancellation remained visible after completion.
- Missing and invalid capability route tests initially returned 200 and invoked staging. The ActionCard request initially omitted the capability header.
- The late-catalog regression changed the disabled model select from `gpt-5.6-luna` to `claude-haiku-4-5` during an active run.
- The first full browser rerun exposed one stale assertion for `Anthropic 0 public runs`. The corrected contract uses `Anthropic 0 live runs`.

### Green evidence

- Focused Workbench, Operations, trace, metrics, repository and action-route suites pass: 6 files and 64 tests.
- Full Vitest passes: 38 files and 333 tests.
- Full Playwright passes: 17 tests including review-required staging and capability-authorized server mutation.
- Dedicated accessibility Playwright passes: 5 tests.
- ESLint passes.
- Application and contract TypeScript checks pass.
- Strict premium audit passes with zero findings.
- Design lint passes with zero errors and the same nine orphaned-token warnings.

### Accessibility and responsive notes

Axe reports no serious or critical violations for Workbench and Operations at desktop and mobile viewports. The mobile order remains source then preview then trace. Native disabled states expose the locked controls during an active attempt. Loading, terminal failure and recoverable prepared-action failure use explicit status or alert semantics. First-error focus still returns to the invalid upload control after validation unlocks.

The desktop Operations evidence image now reflects demo call attribution and live-run provider configuration. Workbench retains the three-region evidence desk. Mobile retains the approved source-preview-trace order with prepared action before evidence.

### Self-review

- Demo provider counts are excluded in both in-memory aggregation and Neon aggregation.
- Operations distinguishes deterministic demo execution from a real provider or model call.
- One pure display model owns grouped trace labels, deduplication and failure settlement.
- Completion and detail loading are separate states. A private ref closes the cancellation race before the next render.
- Configuration locking covers user input and delayed model-catalog hydration.
- Action staging remains pessimistic, duplicate-safe, idempotent and recoverable.
- The server verifies a hash-backed browser capability before action mutation. Rate limiting remains ahead of capability lookup.
- No API key was read or used.

### Concerns

- Browser automation covers Chromium only.
- Design lint still reports nine existing orphaned-token warnings but no error.
- Development rendering reports the expected Next CSP `eval()` warning. React does not use that development behavior in production.
- Live-provider acceptance remains outside this keyless task.

## Fix round 2/5: direct demo attribution and publishing failure projection

### Outcome

The Operations provider control is now explicitly a live-call filter. Selecting OpenAI or Anthropic requires `executionMode: live` so a deterministic demo run cannot match through its submitted provider configuration. The unfiltered option remains `All runs`.

Deterministic coverage now uses provider-neutral offline scenario language. The dashboard no longer presents provider counts for recorded benchmark scenarios and no longer describes fixture-provider combinations.

A terminal failure after publishing starts now projects onto `Resolve and prepare action`. Publishing remains absent from the visible trace while the final visible group changes from complete to needing attention and all active state stops.

### Red evidence

- The first focused Operations run failed three tests because the control still exposed `Provider filter` and the dashboard still rendered provider-attributed benchmark copy.
- The publishing regression failed with `Resolve and prepare action` at `pass` instead of `error` after the raw publishing stage became active and the run failed.

### Green evidence

- Focused trace, Workbench and Operations suites pass: 3 files and 13 tests.
- Relevant Operations browser regressions pass: 2 Chromium tests.
- Full Vitest passes: 38 files and 335 tests.
- ESLint passes.
- Application and contract TypeScript checks pass.

### Accessibility and responsive notes

This fix changes filter semantics, visible copy and trace status projection without changing layout or responsive order. The relevant browser regressions confirm the provider filter remains keyboard-addressable through its native select and the active inspector remains usable after URL-state restoration. No new accessibility suppression or custom popup behavior was introduced.

### Self-review

- Provider matching uses execution mode and submitted provider together when a live-call filter is active.
- The unfiltered state still shows all runs and does not imply that every visible row made a provider call.
- Deterministic benchmark language describes offline scenario checks without naming provider coverage.
- Publishing stays outside display-stage definitions and its terminal failure is projected only onto the final visible operational group.
- Existing hidden publishing behavior and grouped-stage announcement deduplication remain intact.
- No API key was read or used.

### Concerns

- Browser verification covers Chromium only.
- Development rendering reports the expected Next CSP `eval()` warning.
- Live-provider acceptance remains outside this keyless task.
