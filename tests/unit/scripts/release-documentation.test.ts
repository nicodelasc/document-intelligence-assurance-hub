import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();

function readProjectFile(path: string) {
  return readFileSync(join(projectRoot, path), "utf8");
}

const readme = readProjectFile("README.md");
const architecture = readProjectFile("docs/architecture.md");
const deployment = readProjectFile("docs/deployment-checklist.md");
const evaluation = readProjectFile("docs/evaluation-report.md");
const privacy = readProjectFile("docs/privacy-and-retention.md");
const design = readProjectFile("DESIGN.md");
const uxContract = readProjectFile("UX-CONTRACT.md");
const walkthrough = readProjectFile("docs/walkthrough-script.md");

const releaseFacingDocumentation = [
  design,
  uxContract,
  readme,
  architecture,
  deployment,
  evaluation,
  walkthrough,
  privacy,
].join("\n");

const pendingRoutes = [
  "Built-in sample through OpenAI",
  "Custom upload through Anthropic",
];

function expectPendingProcessingRoutes(markdown: string) {
  const routeRows = markdown
    .split(/\r?\n/)
    .filter((line) => line.trimStart().startsWith("|"))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .filter(([route]) => pendingRoutes.includes(route));

  for (const route of pendingRoutes) {
    const statuses = routeRows
      .filter(([rowRoute]) => rowRoute === route)
      .map(([, status]) => status);
    expect(statuses, `${route} must be Pending in its own row`).toEqual([
      "Pending",
    ]);
  }
}

function expectCompleteMockedBoundary(markdown: string, path: string) {
  expect(markdown, `${path} must identify mocked local acceptance`).toMatch(
    /local acceptance is mocked/i,
  );
  expect(markdown, `${path} must report the paid-call count`).toMatch(
    /zero paid calls have been made/i,
  );
  expect(markdown, `${path} must keep both connected observations pending`).toMatch(
    /both connected production observations are Pending/i,
  );
}

describe("Operations release documentation", () => {
  it("documents the live and recorded submission labels plus the source-origin boundary", () => {
    expect(releaseFacingDocumentation).toContain("Run live document review");
    expect(releaseFacingDocumentation).toContain(
      "Assess sample without AI processing",
    );
    for (const label of [
      "Original demo document",
      "Exact copy of a demo document",
      "Source unverified",
    ]) {
      expect(releaseFacingDocumentation).toContain(label);
    }
    expect(releaseFacingDocumentation).toMatch(
      /exact SHA-256 matching.*byte equality.*committed synthetic sample/is,
    );
    expect(releaseFacingDocumentation).toMatch(
      /does not prove authorship, authenticity, fraud status or malware safety/i,
    );
    expect(releaseFacingDocumentation).toMatch(
      /screenshots, re-encodings, edits and unrelated supported files.*Source unverified.*not rejected.*person.*before.*posting handoff/is,
    );
  });

  it("documents the deliberate paid-call boundary and pending connected observations", () => {
    expect(releaseFacingDocumentation).toMatch(/one deliberate reviewer click/i);
    expect(releaseFacingDocumentation).toContain("Prepared only - not sent");
    expect(evaluation).toMatch(/zero paid calls have been made/i);
    expect(evaluation).toMatch(/mocked.*separate.*connected production/is);
    expect(evaluation).toMatch(
      /OpenAI.*GPT-5\.6 Luna.*Pending.*Anthropic.*Claude Haiku 4\.5.*Pending/is,
    );
    expect(evaluation).toMatch(/two-call acceptance boundary/i);
  });

  it("states the complete mocked and connected-observation boundary in each release document", () => {
    for (const [path, markdown] of [
      ["docs/architecture.md", architecture],
      ["docs/deployment-checklist.md", deployment],
      ["docs/privacy-and-retention.md", privacy],
    ] as const) {
      expectCompleteMockedBoundary(markdown, path);
    }
  });

  it("records dated model rates and the conservative default budget derivation", () => {
    expect(releaseFacingDocumentation).toMatch(
      /GPT-5\.6 Luna.*US\$0\.20.*US\$1\.20/is,
    );
    expect(releaseFacingDocumentation).toMatch(
      /Claude Haiku 4\.5.*US\$1\.00.*US\$5\.00/is,
    );
    expect(releaseFacingDocumentation).toMatch(/pricing.*2026-09-01/is);
    expect(releaseFacingDocumentation).toMatch(
      /GPT-5\.6.*272,000.*two times.*input.*1\.5 times.*output/is,
    );
    expect(releaseFacingDocumentation).toMatch(
      /US\$8\.46.*conservative reservation ceiling.*not expected spend/is,
    );
    expect(releaseFacingDocumentation).toMatch(
      /repository-wide.*original demo runs.*exact-copy uploads.*unverified uploads/is,
    );
  });

  it("states the procurement exception-triage problem and controlled handoff boundary", () => {
    expect(readme).toMatch(
      /finance and warehouse teams.*supplier invoices.*goods receipts.*before payment or inventory posting/is,
    );
    expect(readme).toMatch(
      /extracts evidence.*trusted synthetic records.*identifies exceptions.*controlled human handoff/is,
    );
    expect(releaseFacingDocumentation).toMatch(
      /all documents and reference records are synthetic/is,
    );
    expect(releaseFacingDocumentation).toMatch(
      /ERP posting, payment, inventory, email and archive integrations are simulated/is,
    );
  });

  it("records only the approved outcome-specific Workbench actions", () => {
    for (const label of [
      "Prepare posting handoff",
      "Assign exception review",
      "Draft clarification request",
      "Request clearer evidence",
      "Assign manual review",
      "Replace document",
      "Retry processing",
      "Replace with a supported procurement document",
    ]) {
      expect(uxContract).toContain(label);
    }

    expect(uxContract).toMatch(/approve_and_stage.*internal identifier/is);
    expect(uxContract).toMatch(/new events.*prepared/is);
  });

  it("keeps linked deployment and privacy records on the procurement triage journey", () => {
    expect(deployment).toMatch(/Review incoming procurement documents/i);
    expect(deployment).toContain("Assess for exceptions");
    expect(deployment).toContain("Triage exception and prepare handoff");
    for (const label of [
      "Prepare posting handoff",
      "Assign exception review",
      "Draft clarification request",
      "Request clearer evidence",
      "Assign manual review",
      "Replace document",
      "Retry processing",
      "Replace with a supported procurement document",
    ]) {
      expect(deployment).toContain(label);
    }
    expect(deployment).toMatch(
      /Procurement review queue.*Triage status.*Prepared case handoffs/is,
    );
    expect(deployment).toMatch(/all documents and reference records are synthetic/is);
    expect(deployment).toMatch(
      /no external business system is changed/is,
    );
    expect(privacy).toMatch(
      /live synthetic.*handwritten.*text-native PDF.*rendered.*local OCR.*native text.*OCR text.*merged/is,
    );
  });

  it("documents queue-first Operations while keeping technical detail in the inspector", () => {
    expect(design).toMatch(
      /Procurement review queue.*before.*Processing performance.*Reference quality suite/is,
    );
    expect(uxContract).toMatch(
      /Procurement review queue.*before.*processing-performance.*assurance/is,
    );
    expect(architecture).toMatch(
      /document reference.*document type.*review decision.*exception.*prepared next step.*received time/is,
    );
    expect(architecture).toMatch(
      /run ID.*model.*token.*latency.*expiry.*safe diagnostics.*inspector/is,
    );
  });

  it("records approved sample overrides and the fail-closed visual-grounding boundary", () => {
    expect(architecture).toMatch(/assets\/sample-overrides/i);
    expect(architecture).toMatch(
      /sample generator.*copies.*approved.*instead of.*overwrit/is,
    );
    expect(architecture).toMatch(
      /text-native PDF.*rendered.*local OCR.*native text.*OCR text.*merged/is,
    );
    expect(architecture).toMatch(
      /recorded synthetic runs.*do not invoke OCR or a provider/is,
    );
    expect(evaluation).toMatch(
      /visual evidence.*conflicts.*Needs review.*cannot be decoded confidently.*Incomplete/is,
    );
    expect(evaluation).toMatch(/zero false-clear/i);
  });

  it("rejects retired primary labels from release-facing documentation", () => {
    for (const retiredLabel of [
      /\bApprove and stage\b/i,
      /\bRun explorer\b/i,
      /\bProcess document\b/i,
      /\bResolve and prepare action\b/i,
    ]) {
      expect(releaseFacingDocumentation).not.toMatch(retiredLabel);
    }
  });

  it("separates bounded operational detail from repository-wide anonymous metrics", () => {
    expect(readme).toMatch(/newest 100 public run summaries/i);
    expect(architecture).toMatch(/repository-wide anonymous run aggregate/i);
    expect(architecture).toMatch(/repository-wide active-detail lifecycle/i);
    expect(architecture).toMatch(/15-second cache/i);
  });

  it("separates completed cost estimates from quota settlement and reservations", () => {
    expect(readme).toMatch(/confirmed dispatched completed runs/i);
    expect(architecture).toMatch(/trustworthy nonzero token usage/i);
    expect(architecture).toMatch(/failed dispatched request.*settled spend/is);
    expect(architecture).toMatch(/settled spend.*active reservations/is);
    expect(readme).toContain("No confirmed model runs");
    expect(readme).toContain("US$1 = S$1.35");
  });

  it("keeps reference observations separate from adapter contract cases", () => {
    expect(evaluation).toMatch(/exactly 10 provider-neutral observations/i);
    expect(evaluation).toMatch(/20 adapter contract cases/i);
    expect(evaluation).toMatch(/fallback observations make no provider claim/i);
    expect(evaluation).toMatch(/dated task 6 verification baseline/i);
    expect(evaluation).toMatch(
      /historical baseline, not the current final suite/i,
    );
  });

  it("documents aggregate retention without weakening workflow boundaries", () => {
    expect(privacy).toMatch(/repository-wide anonymous aggregates/i);
    expect(privacy).toMatch(
      /newest 100.*Procurement review queue.*Triage status.*Prepared case handoffs.*processing performance.*review-record/is,
    );
    expect(privacy).toMatch(/workflow events are removed/i);
    expect(privacy).toMatch(/prepared only.*not sent/is);
    expect(privacy).toMatch(/no external connector/i);
  });

  it("defines cleanup backlog and the latest workflow projection precisely", () => {
    expect(architecture).toMatch(
      /expired detailed runs awaiting tombstoning.*physical cleanup jobs/is,
    );
    expect(architecture).toMatch(
      /latest workflow projection.*action.*status.*timestamp/is,
    );
    expect(privacy).toMatch(
      /latest workflow projection.*action.*status.*timestamp/is,
    );
  });

  it("limits the no-run-ID claim to aggregate projections", () => {
    expect(privacy).toMatch(/aggregate projections.*do not expose.*run IDs/is);
    expect(privacy).toMatch(
      /newest 100 public run summaries.*do include run IDs/is,
    );
  });

  it("retains the two pending production observations and no-provider-claim boundaries", () => {
    expectPendingProcessingRoutes(readme);

    expect(readme).toMatch(/prepared only.*not sent/is);
    expect(readme).toMatch(/no external connector/i);
    expect(readme).toMatch(/sample results.*no AI processing/i);
  });

  it("rejects a Pending status moved to a different table row", () => {
    const mutatedReadme = `${readme.replace(
      /\| Built-in sample through OpenAI\s+\| Pending \|/,
      "| Built-in sample through OpenAI    | Blocked |",
    )}\n| Unrelated route | Pending |`;

    expect(mutatedReadme).not.toBe(readme);
    expect(() => expectPendingProcessingRoutes(mutatedReadme)).toThrowError(
      "Built-in sample through OpenAI must be Pending in its own row",
    );
  });
});
