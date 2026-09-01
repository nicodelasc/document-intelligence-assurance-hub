import type { NextConfig } from "next";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'self' blob:",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
].join("; ");

const sameOriginDocumentContentSecurityPolicy = contentSecurityPolicy.replace(
  "frame-ancestors 'none'",
  "frame-ancestors 'self'",
);

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@napi-rs/canvas",
    "@tesseract.js-data/eng",
    "tesseract.js",
  ],
  outputFileTracingIncludes: {
    "/api/runs": [
      "./node_modules/@tesseract.js-data/eng/4.0.0_best_int/**/*",
      "./node_modules/bmp-js/**/*",
      "./node_modules/is-url/**/*",
      "./node_modules/node-fetch/**/*",
      "./node_modules/regenerator-runtime/**/*",
      "./node_modules/tesseract.js/src/**/*",
      "./node_modules/tesseract.js-core/**/*",
      "./node_modules/wasm-feature-detect/**/*",
    ],
  },
  async rewrites() {
    return [{ source: "/favicon.ico", destination: "/icon.svg" }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), microphone=()",
          },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        source: "/api/runs/:id/document",
        headers: [
          {
            key: "Content-Security-Policy",
            value: sameOriginDocumentContentSecurityPolicy,
          },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        source: "/samples/:path*.pdf",
        headers: [
          {
            key: "Content-Security-Policy",
            value: sameOriginDocumentContentSecurityPolicy,
          },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
