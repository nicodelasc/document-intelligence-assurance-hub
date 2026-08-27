# Interface fidelity ledger

## Workbench

| Comparison point | Concept evidence | Render evidence | Ruling |
|---|---|---|---|
| First viewport | Source rail, document desk and trace rail form one review surface. | `verification/workbench-1536x1024.png` preserves the same three-region composition. | Match |
| Selection signature | Chosen samples and providers use a cobalt inline rail with a blue tint. | Both chosen controls use the shared selected state. | Match |
| Document role | The document is the largest visual object and remains readable above the fold. | The code-native fixture sheet fills the centre without browser PDF instability. | Match with spec-required preview change |
| Typography | Route heading is distinct from compact control and identifier text. | Manrope, Inter and IBM Plex Mono are loaded locally for their documented roles. | Match |
| Surface language | Thin rules and tonal sections create hierarchy without floating cards. | Shared rule panels use one-pixel borders and no static shadows. | Match |
| Public history | The lower ledger keeps recent work available for comparison. | The render hydrates a bounded public ledger from `GET /api/runs` with explicit loading, empty and safe-error states. Two active public details remain comparison-ready after refresh. | Match with public-only data controls |
| Responsive order | Source, document and trace remain the task order. | `verification/workbench-390x844-reduced-motion.png` shows source first and keeps controls reachable. | Match |

Above-the-fold copy diff: the render keeps the required heading, plain-language source sentence, keyless notice, providers and run action. Concept-only Help, Reviewer and extra document metadata were removed. The public-visibility copy was corrected from 24 hours to less than 24 hours.

## Operations

| Comparison point | Concept evidence | Render evidence | Ruling |
|---|---|---|---|
| Metric band | Four metrics form one ruled full-width band. | `verification/operations-1536x1024.png` preserves the four-column band. | Match |
| Operational signals | Latency, provider usage, quality and retention read as one workspace. | The four ruled panels share density and alignment. | Match |
| Chart treatment | Cobalt bars sit beside literal operational values. | Recharts renders the step-duration chart with an adjacent text summary. | Match |
| Run ledger | The semantic table stays open beside a detail inspector. | The explorer and inspector retain their side-by-side relationship at desktop. | Match |
| Run inspector | The selected run combines preview, extracted values, comparison evidence and telemetry. | Honest section headings replace inert tab labels. An active same-origin preview sits with structured extraction, per-field reference comparison, formatted telemetry, safe errors and public metadata. | Match with safer navigation semantics |
| Scenario rail | Numeric assumptions and results stay in a narrow right rail. | Every scenario result repeats the illustrative claim boundary. | Match with stronger claim labeling |
| Mobile transformation | Narrow layouts preserve complete information. | `verification/operations-390x844-reduced-motion.png` stacks metrics and panels while tables keep horizontal overflow. | Match |

Above-the-fold copy diff: the route uses `Operations` instead of the concept-only `Operations console`. It adds the mandatory keyless notice and labels the benchmark source as recorded. Public provider counts remain separate from the six recorded fixture-provider combinations. Concept-only help and reviewer controls were removed.

## Intentional deviations and remaining risk

- Fixture previews use an app-owned invoice sheet rather than a browser PDF toolbar so screenshot geometry remains stable and only approved fields appear.
- Zero public traffic remains zero. Recorded reference charts and quality values are labeled instead of inventing the concept's traffic counts.
- The concepts show unsupported corporate metadata and a nonzero false-clear count. The implementation follows the specification and keeps false clears at zero.
- Final screenshot capture waits for the Operations loading state to settle. Screenshot-only styling removes the Next development portal without changing the product UI.
- Mobile evidence covers Chromium at 390 by 844 with reduced motion. Physical device and 200 percent zoom checks remain recommended rollout work.
