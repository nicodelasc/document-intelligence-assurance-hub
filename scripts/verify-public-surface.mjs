import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const signatures = [
  {
    category: "credential-shaped value",
    pattern:
      /\b(?:sk-(?:proj|ant)-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{32,}|vercel_blob_rw_[A-Za-z0-9_-]{20,})\b/g,
  },
  {
    category: "raw deletion-token hash",
    pattern: /\bsha256:[a-f0-9]{64}\b/gi,
  },
  {
    category: "full prompt text",
    pattern: /Extract structured fields from an untrusted document\./g,
  },
  {
    category: "hidden reasoning property",
    pattern: /["'](?:reasoning|chainOfThought|chain_of_thought)["']\s*:/gi,
  },
  {
    category: "internal storage locator",
    pattern: /["'](?:documentKey|blobUrl|storageLocator)["']\s*:/gi,
  },
  {
    category: "unsupported impact claim",
    pattern:
      /\bproduction[- ]proven\b|\b\d+(?:\.\d+)?%\s+(?:cost\s+)?savings\b|\b(?:delivered|achieved|generated|created)\s+(?:cost\s+)?savings\b/gi,
  },
  {
    category: "outbound email affordance",
    pattern: /mailto:(?!\\S\+)|\bsend email\b|\brecipient email\b/gi,
  },
  {
    category: "retired public copy",
    pattern: /live custom-run/gi,
  },
  {
    category: "retired public copy",
    pattern: /live-call provider/gi,
  },
  {
    category: "retired public copy",
    pattern: /synthetic benchmark quality/gi,
  },
  {
    category: "retired public copy",
    pattern: /\bapprove and stage\b/gi,
  },
  {
    category: "retired public copy",
    pattern: /\brun explorer\b/gi,
  },
  {
    category: "retired public copy",
    pattern: /\bprocess document\b/gi,
  },
  {
    category: "retired public copy",
    pattern: /\bresolve and prepare action\b/gi,
  },
];

const requiredUiCopy = [
  {
    label: "Review incoming procurement documents",
    pattern: /review incoming procurement documents/i,
  },
  {
    label: "Assess for exceptions",
    pattern: /assess for exceptions/i,
  },
  {
    label: "Exception triage decision",
    pattern: /exception triage decision/i,
  },
  { label: "Prepared next step", pattern: /prepared next step/i },
  { label: "Processing model", pattern: /processing model/i },
  {
    label: "Procurement review operations",
    pattern: /procurement review operations/i,
  },
  {
    label: "Procurement review queue",
    pattern: /procurement review queue/i,
  },
  { label: "Reference quality suite", pattern: /reference quality suite/i },
  { label: "Prepared only - not sent", pattern: /prepared only - not sent/i },
];

const scannedExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".rsc",
  ".ts",
  ".tsx",
  ".txt",
]);

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

export function scanText(text, pathLabel) {
  const findings = [];
  for (const signature of signatures) {
    signature.pattern.lastIndex = 0;
    for (const match of text.matchAll(signature.pattern)) {
      findings.push({
        category: signature.category,
        location: `${pathLabel}:${lineNumber(text, match.index ?? 0)}`,
        marker: match[0].slice(0, 80),
      });
    }
  }
  return findings;
}

export function scanRequiredUiCopy(text, pathLabel) {
  return requiredUiCopy.flatMap(({ label, pattern }) =>
    pattern.test(text)
      ? []
      : [
          {
            category: "required public copy missing",
            location: pathLabel,
            marker: label,
          },
        ],
  );
}

function filesUnder(path, builtServerArtifactsOnly = false) {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) return filesUnder(child, builtServerArtifactsOnly);
    const extension = extname(entry.name).toLowerCase();
    if (!scannedExtensions.has(extension)) return [];
    if (
      builtServerArtifactsOnly &&
      ![".html", ".rsc", ".txt"].includes(extension)
    )
      return [];
    return [child];
  });
}

export function scanPaths(paths) {
  return paths.flatMap(({ path, builtServerArtifactsOnly = false }) =>
    filesUnder(path, builtServerArtifactsOnly).flatMap((file) =>
      scanText(readFileSync(file, "utf8"), file),
    ),
  );
}

const MAX_ORIGIN_RUN_DETAILS = 8;
const MAX_SAME_ORIGIN_REDIRECTS = 5;

async function fetchSameOrigin(fetchImpl, url, base) {
  let current = url;
  for (
    let redirectCount = 0;
    redirectCount <= MAX_SAME_ORIGIN_REDIRECTS;
    redirectCount += 1
  ) {
    const response = await fetchImpl(current, { redirect: "manual" });
    if (response.status < 300 || response.status >= 400) {
      return { response, url: current };
    }
    const location = response.headers.get("location");
    if (!location) {
      throw new Error(
        `public_surface_redirect_missing_location ${current.href}`,
      );
    }
    const next = new URL(location, current);
    if (next.origin !== base.origin) {
      throw new Error(`public_surface_cross_origin_redirect ${next.href}`);
    }
    current = next;
  }
  throw new Error(`public_surface_too_many_redirects ${url.href}`);
}

function activeRunIds(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.runs)) {
    return [];
  }
  return payload.runs
    .flatMap((run) => {
      if (!run || typeof run !== "object") return [];
      if (run.status === "expired" || run.status === "deleted") return [];
      return typeof run.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(run.id)
        ? [run.id]
        : [];
    })
    .slice(0, MAX_ORIGIN_RUN_DETAILS);
}

export async function scanOrigin(origin, fetchImpl = fetch) {
  const base = new URL(origin);
  const pending = [
    new URL("/", base),
    new URL("/workbench", base),
    new URL("/operations", base),
  ];
  const visited = new Set();
  const findings = [];

  while (pending.length > 0) {
    const url = pending.shift();
    if (!url || visited.has(url.href)) continue;
    visited.add(url.href);
    const fetched = await fetchSameOrigin(fetchImpl, url, base);
    const { response } = fetched;
    visited.add(fetched.url.href);
    if (!response.ok)
      throw new Error(
        `public_surface_fetch_failed ${response.status} ${fetched.url.href}`,
      );
    const text = await response.text();
    findings.push(...scanText(text, fetched.url.href));
    if (response.headers.get("content-type")?.includes("text/html")) {
      for (const match of text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
        const asset = new URL(match[1], fetched.url);
        if (asset.origin === base.origin) pending.push(asset);
      }
    }
  }

  const runsUrl = new URL("/api/runs?limit=50", base);
  const { response: runsResponse } = await fetchSameOrigin(
    fetchImpl,
    runsUrl,
    base,
  );
  if (!runsResponse.ok) {
    throw new Error(
      `public_surface_fetch_failed ${runsResponse.status} ${runsUrl.href}`,
    );
  }
  const runsText = await runsResponse.text();
  findings.push(...scanText(runsText, runsUrl.href));
  let runsPayload;
  try {
    runsPayload = JSON.parse(runsText);
  } catch {
    throw new Error(`public_surface_invalid_json ${runsUrl.href}`);
  }

  const metricsUrl = new URL("/api/metrics", base);
  const { response: metricsResponse } = await fetchSameOrigin(
    fetchImpl,
    metricsUrl,
    base,
  );
  if (!metricsResponse.ok) {
    throw new Error(
      `public_surface_fetch_failed ${metricsResponse.status} ${metricsUrl.href}`,
    );
  }
  findings.push(...scanText(await metricsResponse.text(), metricsUrl.href));

  const modelsUrl = new URL("/api/models", base);
  const { response: modelsResponse } = await fetchSameOrigin(
    fetchImpl,
    modelsUrl,
    base,
  );
  if (!modelsResponse.ok) {
    throw new Error(
      `public_surface_fetch_failed ${modelsResponse.status} ${modelsUrl.href}`,
    );
  }
  findings.push(...scanText(await modelsResponse.text(), modelsUrl.href));

  for (const runId of activeRunIds(runsPayload)) {
    const detailUrl = new URL(`/api/runs/${encodeURIComponent(runId)}`, base);
    const { response: detailResponse } = await fetchSameOrigin(
      fetchImpl,
      detailUrl,
      base,
    );
    if (!detailResponse.ok) {
      throw new Error(
        `public_surface_fetch_failed ${detailResponse.status} ${detailUrl.href}`,
      );
    }
    findings.push(...scanText(await detailResponse.text(), detailUrl.href));
  }
  return findings;
}

function originArgument(args) {
  const index = args.indexOf("--origin");
  if (index >= 0) return args[index + 1];
  return args.find((argument) => argument.startsWith("--origin="))?.slice(9);
}

async function main() {
  const root = process.cwd();
  const uiSourcePaths = [
    resolve(root, "src/app"),
    resolve(root, "src/components"),
  ];
  const findings = scanPaths([
    ...uiSourcePaths.map((path) => ({ path })),
    { path: resolve(root, "public") },
    { path: resolve(root, ".next/static") },
    { path: resolve(root, ".next/server/app"), builtServerArtifactsOnly: true },
  ]);
  const aggregatedUiSource = uiSourcePaths
    .flatMap((path) => filesUnder(path))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  findings.push(
    ...scanRequiredUiCopy(aggregatedUiSource, "aggregated UI source"),
  );
  const origin =
    originArgument(process.argv.slice(2)) ?? process.env.PUBLIC_SURFACE_ORIGIN;
  if (origin) findings.push(...(await scanOrigin(origin)));

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(
        `[${finding.category}] ${finding.location} matched ${JSON.stringify(finding.marker)}`,
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    `Public-surface verification passed${origin ? " for local artifacts and origin" : " for local artifacts"}.`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
