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
];

const scannedExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".rsc",
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
    const response = await fetchImpl(url, { redirect: "error" });
    if (!response.ok)
      throw new Error(
        `public_surface_fetch_failed ${response.status} ${url.href}`,
      );
    const text = await response.text();
    findings.push(...scanText(text, url.href));
    if (response.headers.get("content-type")?.includes("text/html")) {
      for (const match of text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
        const asset = new URL(match[1], url);
        if (asset.origin === base.origin) pending.push(asset);
      }
    }
  }

  const runsUrl = new URL("/api/runs?limit=50", base);
  const runsResponse = await fetchImpl(runsUrl, { redirect: "error" });
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
  const metricsResponse = await fetchImpl(metricsUrl, { redirect: "error" });
  if (!metricsResponse.ok) {
    throw new Error(
      `public_surface_fetch_failed ${metricsResponse.status} ${metricsUrl.href}`,
    );
  }
  findings.push(...scanText(await metricsResponse.text(), metricsUrl.href));

  for (const runId of activeRunIds(runsPayload)) {
    const detailUrl = new URL(`/api/runs/${encodeURIComponent(runId)}`, base);
    const detailResponse = await fetchImpl(detailUrl, { redirect: "error" });
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
  const findings = scanPaths([
    { path: resolve(root, "src/app") },
    { path: resolve(root, "src/components") },
    { path: resolve(root, "public") },
    { path: resolve(root, ".next/static") },
    { path: resolve(root, ".next/server/app"), builtServerArtifactsOnly: true },
  ]);
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
