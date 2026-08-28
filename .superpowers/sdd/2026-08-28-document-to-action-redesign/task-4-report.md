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
