#!/usr/bin/env node
/**
 * Wrapper to run the official Xero MCP server alongside this repo's custom MCP.
 *
 * Why a wrapper?
 * - Lets us keep this repo's `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` for the
 *   pipeline-safe custom tools, while allowing separate `XERO_OFFICIAL_*`
 *   credentials/tenant settings for the official server.
 * - Avoids env var conflicts when both servers are configured in the same client.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

function pickEnv(preferredKey, fallbackKey) {
  return process.env[preferredKey] ?? process.env[fallbackKey] ?? "";
}

const officialClientId = pickEnv("XERO_OFFICIAL_CLIENT_ID", "XERO_CLIENT_ID");
const officialClientSecret = pickEnv(
  "XERO_OFFICIAL_CLIENT_SECRET",
  "XERO_CLIENT_SECRET"
);
const officialRedirectUri = pickEnv(
  "XERO_OFFICIAL_REDIRECT_URI",
  "XERO_REDIRECT_URI"
);
const officialTenantId = process.env.XERO_OFFICIAL_TENANT_ID ?? "";

if (!officialClientId || !officialClientSecret) {
  console.error(
    [
      "Missing Xero credentials for the official Xero MCP server.",
      "Set XERO_OFFICIAL_CLIENT_ID and XERO_OFFICIAL_CLIENT_SECRET (recommended),",
      "or set XERO_CLIENT_ID and XERO_CLIENT_SECRET.",
      "",
    ].join("\n")
  );
  process.exit(1);
}

function resolveOfficialEntry() {
  const require = createRequire(import.meta.url);

  let packageJsonPath = "";
  try {
    packageJsonPath = require.resolve("@xeroapi/xero-mcp-server/package.json");
  } catch {
    return "";
  }

  const pkgDir = dirname(packageJsonPath);
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));

  // Prefer `bin` (what npx uses), fallback to `main`.
  const bin = pkg?.bin;
  const main = pkg?.main;

  let rel = "";
  if (typeof bin === "string") rel = bin;
  else if (bin && typeof bin === "object") {
    const first = Object.values(bin)[0];
    if (typeof first === "string") rel = first;
  }

  if (!rel && typeof main === "string") rel = main;
  if (!rel) return "";

  return resolve(pkgDir, rel);
}

const entry = resolveOfficialEntry();

if (!existsSync(entry)) {
  console.error(
    [
      "Official Xero MCP server is not installed.",
      "Run: npm install -D @xeroapi/xero-mcp-server",
      "",
    ].join("\n")
  );
  process.exit(1);
}

const childEnv = { ...process.env };

// Force official server to use the *official* env values.
childEnv.XERO_CLIENT_ID = officialClientId;
childEnv.XERO_CLIENT_SECRET = officialClientSecret;
if (officialRedirectUri) childEnv.XERO_REDIRECT_URI = officialRedirectUri;

// Avoid accidental conflicts with this repo's custom multi-tenant flow.
// Only pass a tenant hint to the official server if explicitly provided.
if (officialTenantId) {
  childEnv.XERO_TENANT_ID = officialTenantId;
} else {
  delete childEnv.XERO_TENANT_ID;
}

const child = spawn(process.execPath, [entry], {
  stdio: "inherit",
  env: childEnv,
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
