import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

type AuthModule = typeof import("../src/xero/auth.js");

function randomKeyB64(): string {
  return crypto.randomBytes(32).toString("base64");
}

function tmpStorePath(): string {
  return path.join(os.tmpdir(), `.tmp_xero_tokens_${crypto.randomUUID()}.enc`);
}

describe("xero auth multi-tenant token store", () => {
  let storePath: string;
  let auth: AuthModule;

  async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("Timed out waiting for condition");
  }

  beforeEach(async () => {
    vi.restoreAllMocks();
    storePath = tmpStorePath();
    process.env.XERO_TOKEN_ENCRYPTION_KEY = randomKeyB64();
    process.env.XERO_TOKEN_STORE_PATH = storePath;
    vi.resetModules();
    auth = await import("../src/xero/auth.js");
  });

  afterEach(() => {
    delete process.env.XERO_TOKEN_ENCRYPTION_KEY;
    delete process.env.XERO_TOKEN_STORE_PATH;
    vi.unstubAllGlobals();
    // Best-effort cleanup: async flush may leave temp files behind.
    const dir = path.dirname(storePath);
    const base = path.basename(storePath);
    try {
      if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
      if (fs.existsSync(dir)) {
        fs.readdirSync(dir).forEach((file) => {
          if (file === base || file.startsWith(`${base}.tmp.`)) {
            try {
              fs.unlinkSync(path.join(dir, file));
            } catch {
              // ignore
            }
          }
        });
      }
    } catch {
      // ignore
    }
  });

  it("persists tokens encrypted-at-rest and reloads them on module import", async () => {
    auth.storeToken({
      tenantId: "tenant-a",
      accessToken: "access-a",
      refreshToken: "refresh-a",
      expiresAt: Date.now() + 60_000,
    });

    await waitFor(() => fs.existsSync(storePath) && fs.statSync(storePath).size > 0);
    const onDisk = fs.readFileSync(storePath, "utf8");
    expect(onDisk).not.toContain("access-a");
    expect(onDisk).not.toContain("refresh-a");

    vi.resetModules();
    const reloaded = (await import("../src/xero/auth.js")) as AuthModule;
    expect(reloaded.hasToken("tenant-a")).toBe(true);
  });

  it("refreshes tokens independently per tenantId (concurrent tenants)", async () => {
    const TENANT_A = "tenant-a";
    const TENANT_B = "tenant-b";
    const CLIENT_ID = "client-id";
    const CLIENT_SECRET = "client-secret";

    auth.storeToken({
      tenantId: TENANT_A,
      accessToken: "expired-access-a",
      refreshToken: "refresh-a",
      expiresAt: Date.now() - 1,
    });
    auth.storeToken({
      tenantId: TENANT_B,
      accessToken: "expired-access-b",
      refreshToken: "refresh-b",
      expiresAt: Date.now() - 1,
    });

    const fetchMock = vi.fn(async (_url: any, init?: any) => {
      const body = String(init?.body ?? "");
      const params = new URLSearchParams(body);
      const rt = params.get("refresh_token");
      if (!rt) {
        return {
          ok: false,
          status: 400,
          async text() {
            return "missing refresh_token";
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            access_token: `new-access-for-${rt}`,
            refresh_token: `new-refresh-for-${rt}`,
            expires_in: 1800,
          });
        },
        async json() {
          return {
            access_token: `new-access-for-${rt}`,
            refresh_token: `new-refresh-for-${rt}`,
            expires_in: 1800,
          };
        },
      };
    });
    vi.stubGlobal("fetch", fetchMock as any);

    const [a, b] = await Promise.all([
      auth.getValidAccessToken(TENANT_A, CLIENT_ID, CLIENT_SECRET),
      auth.getValidAccessToken(TENANT_B, CLIENT_ID, CLIENT_SECRET),
    ]);

    expect(a).toBe("new-access-for-refresh-a");
    expect(b).toBe("new-access-for-refresh-b");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("de-dupes refresh for concurrent calls to the same tenantId", async () => {
    const TENANT = "tenant-a";
    const CLIENT_ID = "client-id";
    const CLIENT_SECRET = "client-secret";

    auth.storeToken({
      tenantId: TENANT,
      accessToken: "expired-access",
      refreshToken: "refresh-a",
      expiresAt: Date.now() - 1,
    });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 1800,
        });
      },
    }));
    vi.stubGlobal("fetch", fetchMock as any);

    const tokens = await Promise.all([
      auth.getValidAccessToken(TENANT, CLIENT_ID, CLIENT_SECRET),
      auth.getValidAccessToken(TENANT, CLIENT_ID, CLIENT_SECRET),
      auth.getValidAccessToken(TENANT, CLIENT_ID, CLIENT_SECRET),
    ]);

    expect(tokens).toEqual(["new-access", "new-access", "new-access"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A subsequent call should use the refreshed token without fetching again.
    const again = await auth.getValidAccessToken(TENANT, CLIENT_ID, CLIENT_SECRET);
    expect(again).toBe("new-access");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

