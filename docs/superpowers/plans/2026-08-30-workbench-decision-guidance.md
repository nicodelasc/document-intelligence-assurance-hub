# Workbench Decision Guidance Implementation Plan

**Spec:** `docs/superpowers/specs/2026-08-30-workbench-decision-guidance.md`

## Global constraints

- Follow `DESIGN.md`, `UX-CONTRACT.md` and `premium-ui.json`.
- Do not use live provider credentials or make provider calls.
- Write a failing test before production code for every behavior change.
- Keep workflow actions simulated and server-owned.
- Preserve provider dispatch attribution and current retention behavior.
- Use shared UI primitives and semantic interactive elements.
- Do not modify or delete unrelated user files.

## Task 1: Server-owned relevance guardrail

Add document classification to the provider contract and detailed run results. Update the live prompt and recorded provider. Force `irrelevant` and `uncertain` custom documents to `not_found`. Replace their provider proposal with fixed server-owned safe copy. Restrict workflow actions for those classifications to replacement and summary download. Update public serialization and repository compatibility. Cover provider validation, action policy, outcome enforcement, serialization and workflow authorization with unit and contract tests.

## Task 2: Workbench interaction redesign

Add the accessible `How it works` modal. Convert the assurance trace into a terminal disclosure that auto-collapses on success, stays open on failure and resets on a new run. Merge outcome, decision brief, differences and workflow controls into one `Decision and next steps` panel. Preserve focus and live-region behavior. Add responsive styles and component tests for mouse, keyboard, terminal trace states, combined content and guarded controls.

## Task 3: Contract documentation and browser coverage

Update `DESIGN.md` and `UX-CONTRACT.md` with the new disclosure, modal, combined panel and relevance guardrail ownership. Add or update Playwright coverage for the guidance modal, successful trace disclosure, failed trace behavior, combined panel and mobile layout. Run the premium audit, design lint, public-surface verification and focused browser checks.

## Task 4: Final verification and release review

Run the full unit, component and contract suite. Run type checking, lint, production build, dependency audit, premium audit, design lint and public-surface verification. Run the relevant Playwright desktop, keyboard and mobile scenarios. Review the full branch for security, accessibility, policy ownership and spec compliance. Do not deploy or merge until the verified branch is reviewed.
