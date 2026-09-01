# UX Contract

## Product context

- Audience: A headquarters interviewer assessing a public-safe AI automation demonstration.
- Primary jobs: Assess synthetic procurement documents for exceptions, prepare bounded human handoffs, compare two runs and inspect evidence plus operational signals.
- Target market: Portfolio review for a Singapore regional role.
- Active locale: `en-SG`.
- Language/content register and review policy: Plain operational English with conservative claims and source-controlled experience framing.
- Timezone/calendar policy: Store UTC instants and display timezone labels. Use Gregorian dates.
- Accessibility target: WCAG 2.2 AA.

## Business-context sources

| Domain / scope                  | Authoritative source                                                              | Source type                     | Reviewed date |
| ------------------------------- | --------------------------------------------------------------------------------- | ------------------------------- | ------------- |
| Product behavior                | `docs/superpowers/specs/2026-08-27-document-intelligence-assurance-hub-design.md` | Approved product specification  | 2026-08-27    |
| Procurement exception triage    | `docs/superpowers/specs/2026-08-31-procurement-exception-triage.md`               | Approved product specification  | 2026-08-31    |
| Document operations redesign    | `docs/superpowers/specs/2026-08-29-document-operations-workflow-redesign.md`      | Approved redesign specification | 2026-08-29    |
| Experience and claim boundaries | Local claim-controlled resume and workbook named in the specification             | Approved source artifacts       | 2026-08-27    |
| Data lifecycle                  | Approved 24-hour public upload requirement in the specification                   | Product specification           | 2026-08-27    |
| Deletion and retention          | Approved early-delete token and hourly expiry cleanup requirement                 | Product specification           | 2026-08-27    |
| Billing and payment             | Out of scope                                                                      | Product specification           | 2026-08-27    |
| Legal and regulatory copy       | Prototype warning from the approved specification                                 | Product specification           | 2026-08-27    |

## Visual contract

- Project `DESIGN.md`: `DESIGN.md`.
- Token ownership model: Runtime CSS is canonical and `DESIGN.md` mirrors accepted values.
- Runtime design-system/token source: `src/app/globals.css`.
- Mapping and adapters: CSS variables consumed by shared components in `src/components/ui`.
- Token drift gate: DESIGN lint, premium audit and screenshot fidelity ledger.
- Supported themes: Light only for this portfolio version.
- Design-context owner/review policy: Update design documentation and runtime tokens in the same change.

## Canonical UI Map

| Capability      | Canonical owner                                          | Source of truth                 | Allowed variants                               | Verification                      |
| --------------- | -------------------------------------------------------- | ------------------------------- | ---------------------------------------------- | --------------------------------- |
| Table Selection | `RunExplorer` radio-row selection                        | This contract                   | one selected run                               | component and E2E                 |
| Select/Listbox  | Grouped native model select with accepted platform popup | `/api/models` and this contract | native                                         | keyboard and browser              |
| Tabs            | `FixtureLibrary` document-family tablist                 | This contract                   | Supplier invoices and Warehouse goods receipts | Arrow keys, Home, End and browser |
| Form            | Shared labeled field components with Zod adapters        | This contract                   | run and calculator                             | validation E2E                    |
| Scrollbar       | Global application stylesheet                            | `DESIGN.md`                     | stable-gutter geometry                         | computed style                    |
| Toast           | Shared polite status region                              | This contract                   | success, warning, info and error               | live-region test                  |
| CRUD            | Run routes and deletion dialog                           | API contract and this file      | create, read and delete                        | full-flow E2E                     |
| Guidance modal  | `AppShell`, route guidance modules, `GuidedTourDialog` and shared `Dialog` | This contract | route purpose overview and five-step spotlight | component, keyboard and browser |
| Trace disclosure | `AssuranceTrace`                                        | This contract                   | expanded while active or failed                | terminal-state browser            |
| Decision panel  | `WorkbenchView` and `WorkflowPanel`                      | Server result and this contract | outcome, brief, differences and controls       | ordered browser                   |
| Source status   | `SourceOriginStatusNote` and `RunExplorer`                | Server-derived run status       | original, exact copy or unverified              | component and browser             |

## Component behavior

| Component   | Default               | Hover           | Focus               | Active        | Disabled        | Busy                    | Error                    |
| ----------- | --------------------- | --------------- | ------------------- | ------------- | --------------- | ----------------------- | ------------------------ |
| Button      | Intent style          | Stronger border | 2 px focus ring     | Pressed tone  | Muted and inert | Stable spinner          | Inline recovery          |
| Icon button | Named outline control | Surface tint    | 2 px focus ring     | Pressed tone  | Muted and inert | Stable spinner          | Inline recovery          |
| Input       | Labeled rule          | Darker rule     | Focus ring          | n/a           | Muted and inert | Read-only during submit | Text plus `aria-invalid` |
| Search      | Clear when non-empty  | Darker rule     | Focus ring          | n/a           | Muted and inert | Reserved spinner        | Persistent status        |
| Table/list  | Ruled rows            | Surface tint    | Visible row control | Selected rail | n/a             | Stable overlay          | Retry row                |

## Dataset navigation

- Admin tables: Server-ready pagination with a bounded recorded dataset in keyless mode.
- URL state: Run filter, selected run and page belong in URL search parameters when changed by the reviewer.
- Page size: 10 rows.
- Empty/no-results/error/loading treatment: Stable run ledger footprint with distinct copy and retry where safe.
- Back/scroll restoration: URL state and native browser restoration.
- Selection scope: One run for exploration. Comparison uses exactly two explicit run selections.

## Flow ledger

| Operation               | Trigger                         | Pending                                         | Success destination        | Success feedback                                     | Failure recovery                    | Focus outcome             | Source ref            |
| ----------------------- | ------------------------------- | ----------------------------------------------- | -------------------------- | ---------------------------------------------------- | ----------------------------------- | ------------------------- | --------------------- |
| Create live run         | `Run live document review`      | Streamed stage rail                             | Same Workbench             | Final result and status announcement                 | Safe retry or model reselection     | Decision heading          | Product specification |
| Create recorded run     | `Assess sample without AI processing` | Streamed stage rail                        | Same Workbench             | Recorded result and no-AI attribution                | Preserve selected sample            | Decision heading          | Product specification |
| Prepare workflow action | Outcome-specific action control | Pessimistic busy control or confirmation dialog | Same Workbench             | Server-returned prepared workflow event              | Preserve proposal and retry         | Prepared next step        | Product specification |
| Compare runs            | `Compare runs`                  | Stable inline loader                            | Same Workbench             | Difference table                                     | Preserve selections and retry       | Comparison heading        | Product specification |
| Delete run              | `Delete now`                    | Dialog action busy                              | Run list                   | `Run deleted` status                                 | Dialog remains open with safe error | Next run or list heading  | Product specification |
| Search runs             | Search input                    | Stable ledger loader                            | Same Operations route      | Result count                                         | Clear and retry                     | Search or results heading | Product specification |
| Upload/background job   | `Run live document review` or `Assess sample without AI processing` | Three named progress groups | Same Workbench             | Prepared action, evidence and private deletion token | Cancel, retry or synthetic sample   | Current stage or outcome  | Product specification |
| Cancel/back             | `Cancel run` or route link      | Stop pending client request                     | Same route or chosen route | Neutral cancellation status                          | Preserve selected source            | Originating control       | Product specification |
| Hard-delete             | `Delete now`                    | Danger dialog busy                              | Active runs list           | Deleted status                                       | Retry with same token               | Next logical run          | Product specification |

## Outcome-specific workflow actions

| Run result                   | Available controls                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clear or Evidence-consistent | `Prepare posting handoff`                                                        |
| Needs review or Conflict     | `Assign exception review` and `Draft clarification request`                      |
| Incomplete or Not found      | `Request clearer evidence`, `Assign manual review` and `Replace document`         |
| Failed                       | `Retry processing`                                                               |
| Irrelevant or uncertain custom document | `Replace with a supported procurement document`                                  |

Every control prepares a human handoff without executing a downstream action. Recipient-based controls accept only a server-approved synthetic business role. `Draft clarification request` uses the bounded prepared-email preview labelled `Prepared only - not sent` and no control contacts an external system. The historical `approve_and_stage` value remains an internal identifier for compatibility. New events use status `prepared` and no event claims that posting occurred. The server owns document classification as `supplier_invoice`, `warehouse_goods_receipt`, `irrelevant` or `uncertain`. Provider-authored document content is untrusted: it cannot choose the outcome, safety wording, action status or available controls. `irrelevant` and `uncertain` force `not_found`, use the server-owned safe brief and expose only the restricted replacement control. `Source unverified` always removes `Prepare posting handoff` and requires a person before any posting handoff while preserving outcome-appropriate manual-review controls.

## Source-origin contract

- `server_original` displays `Original demo document` for a server-selected committed synthetic fixture.
- `recognized_copy` displays `Exact copy of a demo document` for a custom upload with exact committed bytes.
- `unverified` displays `Source unverified` for every other valid custom upload.
- Exact SHA-256 matching proves byte equality with a committed synthetic sample only. It does not prove authorship, authenticity, fraud status or malware safety.
- Screenshots, re-encodings, edits and unrelated supported files are processed as `Source unverified`. They are not rejected by origin classification.
- Public output never includes a digest, matched fixture identifier or manifest entry.

## Visual-grounding contract

- Approved reviewer-written sources live under `assets/sample-overrides/` and keep the canonical public filenames.
- The sample generator copies approved source PDFs instead of overwriting them with generated placeholder handwriting. Matching approved PNG previews keep the recorded page geometry.
- Live synthetic fixtures with handwritten evidence request explicit text-and-visual grounding. A validated text-native PDF page is rendered for bounded local OCR then native text and OCR text are merged for page-scoped evidence checks.
- Recorded synthetic runs preserve their deterministic result and do not invoke OCR or a provider. Custom uploads retain the bounded text-or-scan path.
- Visual grounding is local, cancellable, limited to validated pages and fail-closed. It does not introduce a second provider call.
- An approved handwriting fixture may resolve only to `Exception review required` when decoded evidence conflicts or `Awaiting readable evidence` when it cannot be decoded confidently. It must never resolve to a clear decision.

## Model and cost contract

- GPT-5.6 Luna and Claude Haiku 4.5 are the recommended defaults.
- Pricing is dated 2026-09-01. Per-million input and output estimates are GPT-5.6 Luna US$0.20 and US$1.20, GPT-5.6 Terra US$2.00 and US$12.00, Claude Haiku 4.5 US$1.00 and US$5.00 and Claude Sonnet 5 US$2.00 and US$10.00.
- GPT-5.6 input above 272,000 tokens uses the long-context tier for the full request at two times input and 1.5 times output.
- The US$8.46 default daily budget is the highest supported two-call reservation rounded upward to cents. It is a conservative reservation ceiling and not expected spend.
- One deliberate reviewer click on `Run live document review` is the paid-call boundary. Page load, preview, model selection, validation and recorded review cannot reserve spend.

## Navigation and responsive behavior

- Route document title policy: `{Page} — Document Intelligence Assurance Hub`.
- Route error behavior: App-owned not-found and safe server error pages keep route navigation available.
- Route-state policy: Workbench and Operations are bookmarkable routes. Operations selection is URL-backed.
- Responsive transformation: Workbench library, preview and trace stack in that order. Family tabs and the five active variants stack without horizontal page overflow at 390 px. Built-in documents use a rendered raster preview with an `Open full document` link to the source PDF. Custom PDFs use the browser PDF iframe and custom images use a local raster preview. `What changed` moves below the built-in preview. `Review result` and `Prepared next step` remain before the evidence ledger. The route-specific `How it works` trigger follows the product name before navigation in DOM and keyboard order. At 900 px and below it stays beside the product name in the first header row while navigation moves below it. Guided-tour callouts use collision-aware placement with 16 px viewport clearance on desktop and a fixed safe-area-aware bottom card at 720 px and below. Mobile targets scroll into the upper page without horizontal overflow or callout overlap. Operations uses the same rendered built-in preview plus full-document link. Operations starts with four summary metrics then a two-thirds Operations workspace and one-third Costs workspace. The `Procurement review queue` appears before processing-performance and assurance panels. At 960 px and below Operations stacks before Costs. The queue scrolls inside its own region and the 390 px page root stays within the viewport.
- Truncation/full-value access: Important evidence wraps. Long IDs provide a labeled copy control.
- Focus restoration and sticky-obstruction policy: Sticky regions use `scroll-margin` and never cover focused controls.

## Overlays and feedback

- Dialog primitive: Shared accessible dialog with inert backdrop, Escape close and focus restoration to the invoking trigger. Route-specific lazy modules isolate Workbench tour code from cold Operations and Operations tour code from cold Workbench. Both use the same visible `How it works` label and the same guidance control plus `GuidedTourDialog` behavior. Workbench opens `How procurement exception triage works` then follows `Select a procurement document`, `Processing model`, `Assess for exceptions`, `Review progress` and `Review result`. Operations opens `What Operations shows` then follows `Triage overview`, `Procurement review queue`, `Workflow health`, `Assurance safeguards` and `Cost governance`. Operations uses only compact stable targets and disables tour start while metrics are loading or unavailable. Each step focuses its callout heading before Back, Next or Finish navigation and receives collision-aware geometry before paint. Background clicks and target clicks cannot dismiss the modal or activate page controls. Back and Next move between steps. Finish, Exit guided tour, Close and Escape restore focus to the header trigger. Leaving a route closes guidance and returning does not reopen it. Scroll, resize, target-size and visual viewport changes recompute spotlight geometry. Reduced-motion preference disables smooth target scrolling and the 180 ms settle. Forced-colors mode preserves the shade, target outline and arrow with system colors.
- Destructive confirmation levels: Early deletion is irreversible for detailed public data and uses danger intent with explicit consequence.
- Toast placement/duration/deduplication: One top-right polite region. Critical corrections remain inline.
- Alert/banner scope and persistence: Upload consent is persistent for custom documents. `Checking processing availability` appears while server metadata is loading and `Processing availability unavailable` appears if metadata cannot be resolved. `Sample results - no AI processing` appears only for a built-in fixture after the selected provider resolves as unavailable. Its button is `Assess sample without AI processing`. An available provider uses `Run live document review`. An unavailable custom route instead shows `Processing unavailable for this model`.
- Tooltip delay/dismissal: Supplemental only and dismissible with Escape.
- Layer contract: dialog above popover above toast above sticky content.

## Async and resilience

- Mutation default: Pessimistic.
- Idempotency and duplicate-submit policy: Client run identifier and server guard prevent duplicate run submissions. Exactly one deliberate reviewer click starts a submission. Workflow action preparation is pessimistic and ignores duplicate clicks while the server operation is pending. The server enforces outcome-specific action policy. A repeated authorized action request returns the existing simulated event.
- Offline/read-stale/write behavior: Built-in deterministic fallback remains usable only after provider metadata resolves as unavailable. Custom input stays local while metadata is loading or failed and when the selected provider is unavailable. Connectivity failures preserve inputs.
- Retry/backoff/timeout behavior: One retry only for provider 429 or 5xx errors and no silent provider switch.
- Long-running progress and return path: Named stages stream to the active Workbench. Live announcements use only `Understand document`, `Verify evidence` and `Triage exception and prepare handoff` then suppress duplicates. The trace starts expanded and resets to expanded for a new run. A successful terminal run collapses to a summary with stage count and duration when available. The reviewer can reopen its named detail region with the disclosure button. A failed terminal trace remains expanded and settling the active visible group leaves safe diagnostics available.
- Decision information order: A terminal Workbench result renders one `Review result` panel in this order: verified outcome, decision brief, evidence differences and `Prepared next step` controls. Evidence ledger and activity timeline follow as separate panels.
- Stale-request policy: Abort or request identifiers stop old responses from replacing current state. Source controls and model selection remain disabled during validation and execution. Completion ends cancellation before prepared-action detail loading starts.
- Dialog/form preservation: Errors preserve safe values and selected files until removal or retry.

## Validation

- Schema layer: Shared Zod schemas on client boundaries and server routes.
- Trigger timing: Submit first then change or blur for invalid fields.
- Error policy: Inline field text plus a form-level alert for global failure.
- Server mapping: Public safe error code and message only.
- Sensitive-value handling: API keys, SHA-256 document digests, manifest entries, deletion-token hashes, system prompts and hidden reasoning never reach public output. The raw run capability is sent only in a private request header for staging. Custom-upload deletion receipts are shown once to the uploader.
- Submission policy: `noValidate`, first-invalid focus and duplicate-submit prevention.

## Verification

- Required static commands: `npm run format:check`, `npm run design:lint`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:a11y`, `npm run test:e2e`, `npm run verify:premium`, `npm run build:production`, `npm run verify:public` and `npm run audit:dependencies`.
- Browser matrix: Chromium desktop 1440x1000 and mobile 390x844 with reduced motion. Workbench and Operations browser coverage includes header order, route-lazy isolation, purpose overviews, five-step spotlight order, inert background, focus restoration, mobile bottom callouts and no horizontal overflow. Workbench coverage also includes reduced-motion behavior, terminal trace disclosure, failed-trace persistence and ordered decision-panel content.
- Accessibility checks: axe scan, keyboard route and form use plus live-region status.
- Component-state coverage: Two-family keyboard tabs, five variants per family, classification icon and text, rendered built-in preview with full-document PDF link, custom PDF iframe, direct native file picker, grouped model selection, live and recorded action labels, loading and failed availability states, conditional unavailable-provider feedback, three source-origin labels, unverified posting restriction, custom incomplete-evidence wording, three-stage trace, outcome-specific workflow actions, errors, empty history, queue selection, comparison, deletion dialog, four Operations summary cards, repository-wide source counts, 2:1 Operations and Costs workspaces, deterministic-only cost empties, model and outcome filters, URL Back and Forward restoration, fixture differences, comments evidence, workflow activity and safe diagnostics.
- Canonical sibling flow used for comparison: Workbench history compared with the Operations procurement review queue.
- CRUD full-flow evidence: `tests/e2e/workbench.spec.ts`.
- Failure-path evidence: `tests/e2e/failure-and-delete.spec.ts`.

## Demonstration truth boundary

All documents and reference records are synthetic. The extraction, comparison, evaluator safeguards and workflow preparation are functional. ERP posting, payment, inventory, email and archive integrations are simulated and no external business system is changed.
