import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();

function readProjectFile(path: string) {
  return readFileSync(join(projectRoot, path), "utf8");
}

const readme = readProjectFile("README.md");
const architecture = readProjectFile("docs/architecture.md");
const evaluation = readProjectFile("docs/evaluation-report.md");
const privacy = readProjectFile("docs/privacy-and-retention.md");

const pendingRoutes = [
  "Built-in sample through OpenAI",
  "Built-in sample through Anthropic",
  "Custom upload through OpenAI",
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

describe("Operations release documentation", () => {
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
    expect(privacy).toMatch(/newest 100.*workflow.*performance.*explorer/is);
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

  it("retains the pending production route and no-provider-claim boundaries", () => {
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
