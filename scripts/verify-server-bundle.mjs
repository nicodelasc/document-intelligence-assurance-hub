import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const languagePathMarker = "4.0.0_best_int";
const numericDirnamePattern =
  /(?:\(\s*0\s*,\s*[\w$]+\.dirname\s*\)|[\w$]+\.dirname)\(\s*\d+\s*\)/g;

export function findInvalidOcrBundlePatterns(source) {
  if (!source.includes(languagePathMarker)) return [];
  return [...source.matchAll(numericDirnamePattern)].map((match) => match[0]);
}

function javascriptFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) return javascriptFiles(path);
    return path.endsWith(".js") ? [path] : [];
  });
}

export function verifyServerBundle(
  serverDirectory = resolve(process.cwd(), ".next", "server"),
) {
  if (!existsSync(serverDirectory)) {
    throw new Error("The Next.js server bundle is missing.");
  }

  const markedFiles = [];
  const invalidFiles = [];
  for (const path of javascriptFiles(serverDirectory)) {
    const source = readFileSync(path, "utf8");
    if (!source.includes(languagePathMarker)) continue;
    markedFiles.push(path);
    if (findInvalidOcrBundlePatterns(source).length > 0) {
      invalidFiles.push(path);
    }
  }

  if (markedFiles.length === 0) {
    throw new Error("The OCR language path is missing from the server bundle.");
  }
  if (invalidFiles.length > 0) {
    throw new Error(
      `The OCR language path uses an invalid bundled module ID in ${invalidFiles.length} server file(s).`,
    );
  }

  const runsTracePath = resolve(
    serverDirectory,
    "app",
    "api",
    "runs",
    "route.js.nft.json",
  );
  if (!existsSync(runsTracePath)) {
    throw new Error("The runs function trace manifest is missing.");
  }
  const trace = JSON.parse(readFileSync(runsTracePath, "utf8"));
  const traceFiles = Array.isArray(trace.files) ? trace.files : [];
  const hasSelectedLanguageData = traceFiles.some(
    (path) =>
      typeof path === "string" &&
      /@tesseract\.js-data\/eng\/4\.0\.0_best_int\/eng\.traineddata\.gz$/.test(
        path.replaceAll("\\", "/"),
      ),
  );
  if (!hasSelectedLanguageData) {
    throw new Error(
      "The selected OCR language data is missing from the runs function trace.",
    );
  }
  const hasOcrImageTypeDependency = traceFiles.some(
    (path) =>
      typeof path === "string" &&
      /tesseract\.js\/src\/constants\/imageType\.js$/.test(
        path.replaceAll("\\", "/"),
      ),
  );
  if (!hasOcrImageTypeDependency) {
    throw new Error(
      "The OCR worker image type dependency is missing from the runs function trace.",
    );
  }
  const normalizedTraceFiles = traceFiles.flatMap((path) =>
    typeof path === "string" ? [path.replaceAll("\\", "/")] : [],
  );
  const requiredOcrRuntimeDependencies = [
    { label: "bmp-js", pattern: /bmp-js\/index\.js$/ },
    { label: "bmp-js decoder", pattern: /bmp-js\/lib\/decoder\.js$/ },
    { label: "bmp-js encoder", pattern: /bmp-js\/lib\/encoder\.js$/ },
    { label: "is-url", pattern: /is-url\/index\.js$/ },
    { label: "node-fetch", pattern: /node-fetch\/lib\/index\.js$/ },
    {
      label: "regenerator-runtime",
      pattern: /regenerator-runtime\/runtime\.js$/,
    },
    {
      label: "tesseract.js-core",
      pattern: /tesseract\.js-core\/tesseract-core\.js$/,
    },
    {
      label: "tesseract.js-core wasm",
      pattern: /tesseract\.js-core\/tesseract-core\.wasm$/,
    },
    {
      label: "tesseract.js-core LSTM",
      pattern: /tesseract\.js-core\/tesseract-core-lstm\.js$/,
    },
    {
      label: "tesseract.js-core LSTM wasm",
      pattern: /tesseract\.js-core\/tesseract-core-lstm\.wasm$/,
    },
    {
      label: "tesseract.js-core SIMD",
      pattern: /tesseract\.js-core\/tesseract-core-simd\.js$/,
    },
    {
      label: "tesseract.js-core SIMD wasm",
      pattern: /tesseract\.js-core\/tesseract-core-simd\.wasm$/,
    },
    {
      label: "tesseract.js-core SIMD LSTM",
      pattern: /tesseract\.js-core\/tesseract-core-simd-lstm\.js$/,
    },
    {
      label: "tesseract.js-core SIMD LSTM wasm",
      pattern: /tesseract\.js-core\/tesseract-core-simd-lstm\.wasm$/,
    },
    {
      label: "tesseract.js-core relaxed SIMD",
      pattern: /tesseract\.js-core\/tesseract-core-relaxedsimd\.js$/,
    },
    {
      label: "tesseract.js-core relaxed SIMD wasm",
      pattern: /tesseract\.js-core\/tesseract-core-relaxedsimd\.wasm$/,
    },
    {
      label: "tesseract.js-core relaxed SIMD LSTM",
      pattern: /tesseract\.js-core\/tesseract-core-relaxedsimd-lstm\.js$/,
    },
    {
      label: "tesseract.js-core relaxed SIMD LSTM wasm",
      pattern: /tesseract\.js-core\/tesseract-core-relaxedsimd-lstm\.wasm$/,
    },
    {
      label: "wasm-feature-detect",
      pattern: /wasm-feature-detect\/dist\/cjs\/index\.cjs$/,
    },
  ];
  for (const dependency of requiredOcrRuntimeDependencies) {
    if (normalizedTraceFiles.some((path) => dependency.pattern.test(path))) {
      continue;
    }
    throw new Error(
      `The OCR worker runtime dependency ${dependency.label} is missing from the runs function trace.`,
    );
  }

  return { markedFiles: markedFiles.length };
}

const isDirectRun =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    const result = verifyServerBundle();
    process.stdout.write(
      `Server bundle verification passed across ${result.markedFiles} OCR bundle file(s).\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Server bundle verification failed."}\n`,
    );
    process.exitCode = 1;
  }
}
