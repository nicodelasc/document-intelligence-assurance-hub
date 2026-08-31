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
