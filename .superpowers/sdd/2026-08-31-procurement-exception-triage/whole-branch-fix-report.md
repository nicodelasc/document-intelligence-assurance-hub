# Whole-branch layout fix report

## Scope

Resolved the whole-branch review finding I1 without changing the approved procurement workflow, the Operations-first desktop order, tour targets or 390 px behavior. Retained the two EOF whitespace corrections identified as M1.

## Red to green geometry evidence

- The review documented the pre-fix collision at 1536x1024: `Search review records` occupied x=475.39–651.39 and y=392.86–449.31 while the inspector title occupied x=581.83–976.33 and y=382.77–403.77. The intersection was 69.56x10.91 px.
- The partially written Operations browser test was saved at 2026-08-31 16:26:47 while `src/app/globals.css` was saved at 16:27:48. The regression assertion therefore existed before the production CSS change.
- The green implementation makes `.operations-column` an `operations-workspace` inline-size container. At 68rem or less the explorer and inspector stack. At 48rem or less the toolbar uses two columns with the filters and search on their own row.
- The 1536x1024 browser regression now checks that the Operations container is below 68rem, the inspector begins after the queue and no toolbar label, input or select intersects the inspector title or content.

## Screenshot inspection

Regenerated `docs/design/verification/operations-1536x1024.png` through `tests/e2e/visual.spec.ts` after the visible `How it works` control and Operations loading state settled. Manual inspection found readable queue labels, filters and values. The inspector empty state begins below the queue with no collision. Operations remains before Costs. The image contains populated synthetic queue records from the test run. SHA-256: `59F524AA518BD25A0DFFFC61A362DA87D9D013AD79BB0B0445CFE0F476BE7BEC`.

## Generated-file handling

- Restored `next-env.d.ts` to its committed route and root-params references. It has no intended diff.
- Restored the Workbench verification images after visual capture so generated metadata noise is excluded.
- Kept the plan and specification EOF whitespace corrections.

## Commands and results

| Command | Result |
| --- | --- |
| `git status --short` and `git diff --name-status` | Identified the partial patch and generated-file drift. |
| `git diff -- docs/superpowers/plans/2026-08-31-procurement-exception-triage.md docs/superpowers/specs/2026-08-31-procurement-exception-triage.md next-env.d.ts src/app/globals.css tests/e2e/operations.spec.ts` | Confirmed the intended CSS, browser assertion and EOF changes. |
| `Get-Item tests/e2e/operations.spec.ts src/app/globals.css` | Confirmed test-before-CSS chronology. |
| `npm run test:component -- tests/component/operations.test.tsx` | Passed: 4 files and 96 tests. |
| `npx playwright test tests/e2e/operations.spec.ts` | Passed: 1 browser regression. |
| `npx playwright test tests/e2e/visual.spec.ts` | Passed: regenerated visual evidence. |
| `npx playwright test tests/e2e/operations.spec.ts tests/e2e/reviewer-regressions.spec.ts tests/e2e/dual-guided-tours.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/visual.spec.ts` | Passed: 18 browser tests. |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed. |
| `npm run design:lint` | Passed with 0 errors and the existing 9 orphan-token warnings. |
| `python C:/Users/nicho/.codex/plugins/cache/openai-curated-remote/frontend-design-premium/1.4.0/skills/frontend-design-premium/scripts/audit_project.py . --mode strict --no-write` | Passed: 0 findings, violations and warnings. |
| `npm run verify:premium` | Passed: 0 findings, violations and warnings. |
| `git diff --check` | Passed for the staged fix before commit. |
| `git diff --check b4f7f90..HEAD` | Passed for the complete release range after commit. |

## Fix round 2: close the responsive overlap band

### Red to green geometry evidence

- Base commit: `3ae5bbf0fc3e1f014eaab339ae209f02983a552f`.
- Added the responsive-width matrix before changing production CSS. It covers 1536, 1700, 1720, 1760, 1800 and 1920px at 1024px height. For every entry it inspects every queue toolbar label, input and select against the inspector title and content then requires zero intersections.
- RED: the matrix failed at 1700px. The Operations container measured 1090.66px and the layout remained side-by-side although the measured safe side-by-side minimum is 1184px. The review recorded the corresponding `Search review records` and inspector-title collision as 10.53x10.91px.
- GREEN: raised the `operations-workspace` inline-size cutoff from 68rem to 74rem. The matrix measured 981.33px at 1536, 1090.66px at 1700, 1104.00px at 1720, 1130.66px at 1760 and 1157.33px at 1800. Each stacks and reports zero intersections. At 1920 the container is 1237.33px, returns to side-by-side and reports zero intersections.
- The stacking expectation is derived from the measured Operations container width rather than the browser viewport. It keeps the existing 390px mobile order and tour behavior unchanged.

### Screenshot decision

No visual capture was regenerated. The approved 1536x1024 screenshot is already in the stacked state under both the 68rem and 74rem cutoffs, so its appearance is unchanged. Its existing SHA-256 remains `59F524AA518BD25A0DFFFC61A362DA87D9D013AD79BB0B0445CFE0F476BE7BEC`.

### Commands and results

| Command | Result |
| --- | --- |
| `npx playwright test tests/e2e/operations.spec.ts` before the CSS change | RED at 1700px: expected stack, received side-by-side. |
| `npx playwright test tests/e2e/operations.spec.ts` after the CSS change | Passed: responsive geometry matrix is green. |
| `npm run test:component -- tests/component/operations.test.tsx` | Passed: 4 files and 96 tests. |
| `npx playwright test tests/e2e/operations.spec.ts tests/e2e/reviewer-regressions.spec.ts tests/e2e/dual-guided-tours.spec.ts tests/e2e/accessibility.spec.ts` | Passed: 17 browser tests. |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed. |
| `npm run design:lint` | Passed with 0 errors and the existing 9 orphan-token warnings. |
| `python C:/Users/nicho/.codex/plugins/cache/openai-curated-remote/frontend-design-premium/1.4.0/skills/frontend-design-premium/scripts/audit_project.py . --mode strict --no-write` | Passed: 0 findings, violations and warnings. |
| `npm run verify:premium` | Passed: 0 findings, violations and warnings. |
| `git diff --check b4f7f90..HEAD` | Passed after the round-2 commit. |
