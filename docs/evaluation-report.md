# Evaluation report

## Deterministic benchmark result

The verified suite exercises three document fixtures under both selectable provider configurations. That produces six deterministic contract scenarios without calling a provider model.

| Fixture                   | OpenAI configuration | Anthropic configuration | Expected assurance outcome | Expected action status |
| ------------------------- | -------------------- | ----------------------- | -------------------------- | ---------------------- |
| Invoice exception packet  | Not called (demo)    | Not called (demo)       | Needs review               | Needs review           |
| Warehouse receiving sheet | Not called (demo)    | Not called (demo)       | Clear                      | Ready                  |
| Visitor access request    | Not called (demo)    | Not called (demo)       | Incomplete                 | Blocked                |

Deterministic false-clear count: **0**.

This result is driven by checked-in fixture truth and deterministic action policy. It demonstrates fixture routing, schema conformance, field evaluation and decision behavior. It does not measure live model accuracy, production reliability or financial impact.

## Document-to-action verification — 2026-08-28

| Gate                               | Result | Exact evidence                                                                                                                                                                                                                                        |
| ---------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design audit                       | Passed | Premium strict mode returned 0 findings. `DESIGN.md` lint returned 0 errors, 9 orphan-token warnings and 1 token summary. The warnings are non-errors caused by documented semantic aliases that map to runtime CSS variables.                        |
| Lint                               | Passed | `npm run lint` exited 0.                                                                                                                                                                                                                              |
| Typecheck                          | Passed | `npm run typecheck` completed both TypeScript projects with exit 0.                                                                                                                                                                                   |
| Unit, component and contract tests | Passed | `npm test` completed 38 files with 344 of 344 tests passing.                                                                                                                                                                                          |
| Accessibility                      | Passed | `npm run test:a11y` completed 5 of 5 Chromium checks across desktop, mobile and source-order coverage.                                                                                                                                                |
| End to end                         | Passed | `npm run test:e2e` completed 18 of 18 Chromium tests. Coverage includes success, quota fallback, custom validation, action staging, deletion, Operations drill-down, mobile layout and reduced motion.                                                |
| Production build                   | Passed | `npm run build` compiled Next.js 16.3.3 and generated all static and dynamic routes with exit 0.                                                                                                                                                      |
| Browser production flow            | Passed | The built app ran at `http://127.0.0.1:3100` with `AI_LIVE_ENABLED=false` and the documented synthetic-only `ALLOW_IN_MEMORY_PERSISTENCE=true` smoke exception. Browser checks covered `/workbench` and `/operations` at 1536 by 1024 and 390 by 844. |
| Public-surface scan                | Passed | `node scripts/verify-public-surface.mjs --origin=http://127.0.0.1:3100` scanned source, built HTML, built client assets, public API responses and active run details with 0 findings.                                                                 |
| Credential gate                    | Passed | The verification host had no OpenAI or Anthropic key. No live provider request was enabled or attempted.                                                                                                                                              |

### Browser state matrix

| State                        | Evidence                                                                                                                                                                                                                                  | Result                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Page identity and console    | Workbench and Operations returned their route-specific titles. DOM snapshots contained meaningful content with no framework overlay. Browser console inspection returned 0 warnings and 0 errors on both routes.                          | Passed                                             |
| Fixture and model controls   | The warehouse fixture set `aria-pressed=true`. The grouped model control exposed four options. Browser selection reached Claude Haiku 4.5.                                                                                                | Passed                                             |
| Keyboard model selection     | The in-app Browser kept the native control focused but its platform popup did not commit injected ArrowDown events. A focused Chromium E2E check pressed ArrowDown and changed the selected value from `gpt-5.6-luna` to `gpt-5.6-terra`. | Passed with Browser automation limitation recorded |
| Safe validation failure      | Uploading `package.json` through the native chooser produced `Upload a PDF, PNG or JPG document.` and set the file input to `aria-invalid=true`. No run request was sent.                                                                 | Passed                                             |
| Successful deterministic run | The warehouse fixture completed with `Clear`. All three public trace stages completed and publishing stayed hidden. The result did not attribute the demo output to Claude Haiku 4.5.                                                     | Passed                                             |
| Action staging               | `Stage action` returned `Action staged`. Operations showed one staged dry run and the selected run inspector showed `Stage inventory receipt`.                                                                                            | Passed                                             |
| Operations drill-down        | The selected run exposed the document preview, prepared action, structured extraction, reference comparison, diagnostics, safe errors and metadata. Demo provider and model values rendered as `Not called (demo)`.                       | Passed                                             |
| Mobile layout                | Workbench preserved source then preview then trace. Operations had a 380 px page width in a 390 px viewport after a long run ID was selected. The run table retained its own horizontal overflow.                                         | Passed after scoped CSS fix                        |
| Reduced motion               | The project visual test emulated reduced motion at 390 by 844 and recaptured `docs/design/verification/workbench-390x844-reduced-motion.png`. The in-app Browser does not expose media emulation.                                         | Passed through project Chromium coverage           |

Current screenshot evidence:

- `docs/design/verification/workbench-1536x1024.png`
- `docs/design/verification/workbench-390x844-reduced-motion.png`
- `docs/design/verification/operations-1536x1024.png`

### Public-surface inspection

The scan covered server-rendered HTML, `.next/static` client output, public files, `/api/runs`, `/api/metrics` and active run details. It found no credential-shaped value, deletion-token hash, internal storage locator, hidden reasoning property, full prompt text or unsupported impact claim. Browser snapshots also confirmed that deterministic results use `Demo data — no provider call` and Operations uses `Not called (demo)`. The corrected production smoke emitted no application warning or error after startup.

The two deferred minors are resolved. Provider action title, summary, reason, payload label and payload value must contain public-safe text after control-character removal. Five regression cases pass. The PDF generator now downsizes the source texture before embedding it. The three fixture PDFs are 17,690 bytes, 17,580 bytes and 17,507 bytes and remain below 256 KiB while retaining one page plus exact fixture evidence.

## Pending live acceptance

Every item remains pending until Nicholas explicitly authorizes provider keys for a controlled acceptance session.

| Acceptance item                | Status  | Pass evidence required                                                                            |
| ------------------------------ | ------- | ------------------------------------------------------------------------------------------------- |
| One real OpenAI run            | Pending | Valid structured output, public-safe trace, quota settlement and deterministic outcome            |
| One real Anthropic run         | Pending | Valid structured output, public-safe trace, quota settlement and deterministic outcome            |
| Deliberate live failure        | Pending | Safe mapped error, no provider body leak, no false completion and correct reservation handling    |
| Connected retention simulation | Pending | Expired read denied before purge, durable tombstone, Blob retry evidence and zero detail recovery |

Live mode must remain disabled until all four rows pass in the intended connected production configuration. The local in-memory smoke exception is not evidence of durable Neon or Blob behavior.
