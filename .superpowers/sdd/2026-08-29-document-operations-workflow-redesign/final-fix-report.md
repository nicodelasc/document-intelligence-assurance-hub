# Final fix report

## Scope

- Base reviewed and fixed: `0e23ef9e85bc421b660693f0c12de4527c73b0ae`.
- Live provider testing stayed disabled with `AI_LIVE_ENABLED=false`.
- No provider key value was used, added or inspected.
- Generated screenshots and `next-env.d.ts` were preserved unchanged.

## Admission fix

- `POST /api/runs` validates the submitted provider and model before it derives execution mode from `container.providerAvailability`.
- An available selected provider forces live execution for built-in and custom sources even when the client submits `recorded`.
- An unavailable selected provider uses deterministic fallback only for a built-in fixture.
- An unavailable custom route returns `live_disabled` before run claim, quota reservation, provider construction or document storage.
- Admission never changes the validated provider.
- The Workbench now represents model metadata as `loading`, `resolved` or `failed`. `Process document` remains disabled until resolution and remains disabled after failure. A resolved unavailable provider still enables keyless built-in processing while custom processing stays disabled.

## Contract and release documentation

- `UX-CONTRACT.md` now describes rendered raster previews for built-in documents plus the full source PDF link. It retains the custom PDF iframe and documents the matching Operations preview.
- The generic retired action wording was replaced with the current outcome-specific workflow action matrix.
- Retired `Recorded samples`, `Live custom submission` and generic action-staging wording were removed.
- `README.md` states that all four visible live model routes remain a post-key rollout gate. The independent built-in and custom source paths for OpenAI and Anthropic also remain pending.
- No connected provider acceptance is claimed.
- The trailing space in `assets/fonts/Caveat-OFL.txt` line 21 was removed without changing the license text.

## TDD evidence

### RED

Command:

```powershell
$env:AI_LIVE_ENABLED='false'; npm exec vitest run tests/contract/routes/runs-route.test.ts tests/component/workbench.test.tsx
```

Observed before implementation: 2 files failed with 4 failures and 89 passes out of 93 tests. The failures showed that the Workbench button was enabled during model loading, the failed catalogue state was absent, recorded custom input was rejected instead of being forced live for an available provider and unavailable custom input reached provider initialization instead of admission rejection.

After correcting the built-in regression fixture to submit `recorded`, the route-only RED run showed 3 failures and 29 passes out of 32 tests. The available built-in route passed `recorded` to provider construction, the available custom route returned 409 and the unavailable custom route returned 500 after provider initialization.

### GREEN

Command:

```powershell
$env:AI_LIVE_ENABLED='false'; npx vitest run tests/contract/routes/runs-route.test.ts tests/component/workbench.test.tsx
```

Result: 2 files passed and 93 of 93 tests passed.

The route regressions prove:

- Available plus client-recorded built-in input constructs the selected provider in live mode.
- Available plus client-recorded custom input constructs the selected provider in live mode.
- Unavailable plus client-live custom input returns 503 with `live_disabled`.
- The unavailable custom rejection makes zero run-claim calls, zero quota-reservation calls and zero document-storage calls. Repository aggregate run count stays zero.

The component regressions prove:

- The process control is disabled while model availability is loading and no run request is sent.
- A failed model-catalogue request leaves the process control disabled and exposes a safe failure status.
- Resolved provider metadata enables processing.
- Resolved unavailable metadata preserves deterministic built-in processing and keeps custom processing unavailable.

## Final verification evidence

All commands below ran with `AI_LIVE_ENABLED=false` where runtime configuration could apply.

| Check | Result |
|---|---|
| Focused route and Workbench Vitest | 2 files passed, 93 of 93 tests passed |
| Release-documentation Vitest after table correction | 1 file passed, 8 of 8 tests passed |
| Full Vitest | 46 files passed, 526 of 526 tests passed |
| TypeScript | `npm run typecheck` exited 0 |
| ESLint | `npm run lint` exited 0 with 0 errors and 2 existing warnings in `tests/contract/providers/provider-contract.test.ts` lines 133:14 and 133:31 |
| Scoped Prettier | `npx prettier --check --ignore-unknown README.md UX-CONTRACT.md` passed |
| Whitespace | `git diff --check` passed |
| Prose serial-comma scan | `rg -n -P ",\s+(?:and|or)\b" README.md UX-CONTRACT.md .superpowers/sdd/2026-08-29-document-operations-workflow-redesign/final-fix-report.md` returned no matches |

## Deferred acceptance and concerns

- GPT-5.6 Luna, GPT-5.6 Terra, Claude Haiku 4.5 and Claude Sonnet 5 remain unaccepted live routes until authorized keys are introduced and each route passes connected production evidence.
- Built-in and custom source-path acceptance for OpenAI and Anthropic remains pending.
- The two lint warnings are pre-existing and outside this fix wave. No lint error remains.
