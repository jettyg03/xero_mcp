/**
 * Tests for transcript/normaliser.ts (BEN-26).
 * Pure unit tests — no API calls or external deps required.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normaliseTranscript } from "../../transcript/normaliser.js";

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

describe("normaliseTranscript — txt", () => {
  it("returns content trimmed", async () => {
    const result = await normaliseTranscript("  Hello world  ", "txt");
    assert.equal(result, "Hello world");
  });

  it("returns empty string when input is whitespace", async () => {
    const result = await normaliseTranscript("   ", "txt");
    assert.equal(result, "");
  });

  it("defaults to txt format", async () => {
    const result = await normaliseTranscript("no format specified");
    assert.equal(result, "no format specified");
  });
});

// ---------------------------------------------------------------------------
// Whisper JSON — segments array
// ---------------------------------------------------------------------------

describe("normaliseTranscript — whisper_json", () => {
  it("joins segments from a direct array", async () => {
    const json = JSON.stringify([
      { text: "We are building", start: 0, end: 2 },
      { text: "a new ML model.", start: 2, end: 5 },
    ]);
    const result = await normaliseTranscript(json, "whisper_json");
    assert.equal(result, "We are building a new ML model.");
  });

  it("joins segments from .segments field", async () => {
    const json = JSON.stringify({
      segments: [
        { text: "Phase one", start: 0, end: 1 },
        { text: "is complete.", start: 1, end: 2 },
      ],
    });
    const result = await normaliseTranscript(json, "whisper_json");
    assert.equal(result, "Phase one is complete.");
  });

  it("returns top-level text field when present", async () => {
    const json = JSON.stringify({
      text: "Full transcript text here.",
      segments: [{ text: "Full transcript text here.", start: 0, end: 5 }],
    });
    const result = await normaliseTranscript(json, "whisper_json");
    assert.equal(result, "Full transcript text here.");
  });

  it("skips empty segment texts", async () => {
    const json = JSON.stringify([
      { text: "Hello", start: 0, end: 1 },
      { text: "", start: 1, end: 2 },
      { text: "world", start: 2, end: 3 },
    ]);
    const result = await normaliseTranscript(json, "whisper_json");
    assert.equal(result, "Hello world");
  });

  it("throws on invalid JSON", async () => {
    await assert.rejects(
      () => normaliseTranscript("not json", "whisper_json"),
      /whisper_json.*not valid JSON/i
    );
  });

  it("throws when no text or segments found", async () => {
    const json = JSON.stringify({ model: "whisper-1" });
    await assert.rejects(
      () => normaliseTranscript(json, "whisper_json"),
      /whisper_json/i
    );
  });

  it("throws when segments array is empty", async () => {
    const json = JSON.stringify({ segments: [] });
    await assert.rejects(
      () => normaliseTranscript(json, "whisper_json"),
      /whisper_json/i
    );
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("normaliseTranscript — unknown format", () => {
  it("throws on unrecognised format", async () => {
    await assert.rejects(
      // @ts-expect-error — intentional invalid input for test
      () => normaliseTranscript("content", "pdf"),
      /unknown transcript format/i
    );
  });
});
