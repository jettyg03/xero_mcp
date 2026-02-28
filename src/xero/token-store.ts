/**
 * Encrypted, persistent Xero token storage keyed by tenantId.
 *
 * The MCP server is long-lived but may be restarted; we need per-tenant tokens
 * available across calls without requiring a single-tenant-per-process model.
 *
 * Storage model:
 * - In-memory Map for fast access.
 * - Optional encrypted-at-rest file backing store (AES-256-GCM).
 *
 * Env:
 * - XERO_TOKEN_ENCRYPTION_KEY: base64-encoded 32-byte key (required for file store)
 * - XERO_TOKEN_STORE_PATH: optional path to the encrypted token file
 *
 * Linear: BEN-44.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { XeroTokenSet } from "./types.js";

export interface TokenStore {
  get(tenantId: string): XeroTokenSet | undefined;
  has(tenantId: string): boolean;
  set(token: XeroTokenSet): void;
  delete(tenantId: string): void;
  listTenantIds(): string[];
}

type PersistedPayloadV1 = {
  version: 1;
  updatedAt: number;
  tokens: Record<string, XeroTokenSet>;
};

type EncryptedEnvelopeV1 = {
  version: 1;
  alg: "aes-256-gcm";
  iv: string; // base64
  tag: string; // base64
  data: string; // base64 ciphertext
};

class InMemoryTokenStore implements TokenStore {
  private readonly map = new Map<string, XeroTokenSet>();

  get(tenantId: string): XeroTokenSet | undefined {
    return this.map.get(tenantId);
  }
  has(tenantId: string): boolean {
    return this.map.has(tenantId);
  }
  set(token: XeroTokenSet): void {
    this.map.set(token.tenantId, token);
  }
  delete(tenantId: string): void {
    this.map.delete(tenantId);
  }
  listTenantIds(): string[] {
    return [...this.map.keys()];
  }
}

class EncryptedFileTokenStore implements TokenStore {
  private readonly map = new Map<string, XeroTokenSet>();
  private readonly filePath: string;
  private readonly key: Buffer;
  private flushChain: Promise<void> = Promise.resolve();
  private lastFlushError: unknown = undefined;

  constructor(filePath: string, key: Buffer) {
    this.filePath = filePath;
    this.key = key;
    this.loadFromDiskIfPresent();
  }

  get(tenantId: string): XeroTokenSet | undefined {
    return this.map.get(tenantId);
  }
  has(tenantId: string): boolean {
    return this.map.has(tenantId);
  }
  set(token: XeroTokenSet): void {
    this.map.set(token.tenantId, token);
    this.queueFlushToDisk();
  }
  delete(tenantId: string): void {
    this.map.delete(tenantId);
    this.queueFlushToDisk();
  }
  listTenantIds(): string[] {
    return [...this.map.keys()];
  }

  // -------------------------------------------------------------------------
  // Disk IO
  // -------------------------------------------------------------------------

  private loadFromDiskIfPresent(): void {
    if (!fs.existsSync(this.filePath)) return;
    const raw = fs.readFileSync(this.filePath, "utf8").trim();
    if (!raw) return;

    const envelope = JSON.parse(raw) as EncryptedEnvelopeV1;
    if (envelope?.version !== 1 || envelope.alg !== "aes-256-gcm") {
      throw new Error(
        `Unsupported token store envelope format at ${this.filePath}`
      );
    }

    const plaintext = decryptAes256Gcm({
      key: this.key,
      iv: Buffer.from(envelope.iv, "base64"),
      tag: Buffer.from(envelope.tag, "base64"),
      data: Buffer.from(envelope.data, "base64"),
    });

    const payload = JSON.parse(plaintext) as PersistedPayloadV1;
    if (payload?.version !== 1 || typeof payload.updatedAt !== "number") {
      throw new Error(`Invalid token store payload at ${this.filePath}`);
    }

    Object.entries(payload.tokens ?? {}).forEach(([tenantId, token]) => {
      if (tenantId && token?.tenantId === tenantId) {
        this.map.set(tenantId, token);
      }
    });
  }

  private queueFlushToDisk(): void {
    // Chain writes to avoid concurrent flushes. Do not throw from here since
    // callers are typically on the hot path (token refresh / tool calls).
    this.flushChain = this.flushChain
      .then(async () => {
        await this.flushToDiskOnce();
      })
      .catch((err) => {
        this.lastFlushError = err;
      });
  }

  private async flushToDiskOnce(): Promise<void> {
    const payload: PersistedPayloadV1 = {
      version: 1,
      updatedAt: Date.now(),
      tokens: Object.fromEntries(this.map.entries()),
    };

    const plaintext = JSON.stringify(payload);
    const { iv, tag, data } = encryptAes256Gcm({
      key: this.key,
      plaintext,
    });

    const envelope: EncryptedEnvelopeV1 = {
      version: 1,
      alg: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      data: data.toString("base64"),
    };

    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    const tmp = `${this.filePath}.tmp.${crypto.randomUUID()}`;
    await fs.promises.writeFile(tmp, JSON.stringify(envelope), {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.promises.rename(tmp, this.filePath);
  }
}

function encryptAes256Gcm(opts: {
  key: Buffer;
  plaintext: string;
}): { iv: Buffer; tag: Buffer; data: Buffer } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", opts.key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(opts.plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return { iv, tag, data: ciphertext };
}

function decryptAes256Gcm(opts: {
  key: Buffer;
  iv: Buffer;
  tag: Buffer;
  data: Buffer;
}): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", opts.key, opts.iv);
  decipher.setAuthTag(opts.tag);
  const plaintext = Buffer.concat([
    decipher.update(opts.data),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

function defaultTokenStorePath(): string {
  // Keep it outside dist/ and avoid polluting repo root in production.
  // In containers, this should be a mounted volume.
  return process.env.XERO_TOKEN_STORE_PATH || path.join(process.cwd(), ".xero_tokens.enc");
}

function parseEncryptionKeyBase64(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error(
      "XERO_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key (AES-256-GCM)."
    );
  }
  return key;
}

export function createTokenStoreFromEnv(): TokenStore {
  const keyB64 = process.env.XERO_TOKEN_ENCRYPTION_KEY;
  if (!keyB64) {
    return new InMemoryTokenStore();
  }
  const key = parseEncryptionKeyBase64(keyB64);
  return new EncryptedFileTokenStore(defaultTokenStorePath(), key);
}

