# Workbench Decision Guidance

## Purpose

Make the Workbench easier for a non-technical reviewer to understand while preserving evidence-first controls and public-safe dry-run behavior.

## Approved behavior

### How it works

- Add a visually prominent `How it works` button to the Workbench page introduction.
- Open an accessible modal that explains document selection, model selection, processing, evidence review and prepared actions in five ordered steps.
- Use the shared dialog primitive so focus is trapped, Escape closes the modal, the background becomes inert and focus returns to the trigger.
- State clearly that built-in samples use deterministic evidence when live processing is unavailable and every workflow control is a simulation.

### Review progress

- Keep the three-stage assurance trace expanded before processing and while a run is active.
- After a successful run completes, automatically collapse the trace into a concise summary that includes completed stage count and total duration when available.
- Keep a failed trace expanded so safe diagnostics remain visible.
- Allow a reviewer to expand or collapse a terminal trace with a semantic button that exposes `aria-expanded` and controls a named region.
- Reset the trace to expanded when a new run begins.

### Decision and next steps

- Replace the separate Business outcome, Differences and Workflow controls panels with one `Decision and next steps` panel.
- Present the verified outcome first, a short decision brief second, evidence differences third and outcome-specific workflow controls last.
- Retain the current outcome-specific controls: four for clear results, five for review results, five for incomplete results and two for processing failures.
- Keep the evidence ledger and activity timeline as separate panels below the combined decision panel.
- Preserve outcome focus management and polite live announcements after processing.

### Live decision brief and document guardrail

- Reuse the existing structured provider call. Do not add a second model call.
- Add a structured document classification with these values: `supplier_invoice`, `warehouse_goods_receipt`, `irrelevant` and `uncertain`.
- Treat document content as untrusted data. A provider may propose display copy but the server owns the outcome, action status, allowed controls and all safety wording.
- For a supported custom document, display the bounded provider action summary as the live decision brief after server sanitization and evidence verification.
- For built-in samples, display deterministic fixture copy.
- For an `irrelevant` or `uncertain` custom document, force the outcome to `not_found`, discard the provider action proposal and substitute this server-owned brief: `This does not appear to be a supported supplier invoice or warehouse goods receipt. No workflow action was prepared.`
- Unsupported or uncertain documents expose only `Replace document` and `Download review summary` controls.
- No control may contact an external system, approve payment, move inventory or send email.

## Boundaries

- Do not use OpenAI or Anthropic credentials during implementation or verification.
- Provider contract tests use complete mocked structured responses.
- Do not add a new public outcome enum solely for relevance. Use the existing `not_found` outcome with the persisted document classification.
- Store classification with detailed run results so expiry and deletion behavior remain unchanged.
- Keep provider attribution truthful. Configuration is not evidence of dispatch.
- Preserve the existing visual language from `DESIGN.md` and the behavior ownership rules in `UX-CONTRACT.md`.
- Meet WCAG 2.2 AA expectations including keyboard use, visible focus, reduced motion and mobile stacking.

## Acceptance criteria

1. A reviewer can open and close the guidance modal with mouse, keyboard and Escape.
2. A successful trace automatically collapses and can be reopened without losing stage details.
3. A failed trace remains open and can be collapsed manually.
4. One combined decision panel contains outcome, brief, differences and available controls.
5. Supported live mock responses retain evidence-bound dynamic briefs.
6. Irrelevant and uncertain mock responses receive the fixed safe brief and only two safe controls.
7. Provider-authored status, reason or controls cannot bypass server policy.
8. Existing synthetic fixtures still resolve to their expected outcomes and deterministic proposals.
9. Unit, component, contract, accessibility and browser tests pass without provider keys.
10. `DESIGN.md`, `UX-CONTRACT.md` and the premium audit remain consistent with the implementation.
