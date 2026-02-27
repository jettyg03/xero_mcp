/**
 * Tests for transcript/index.ts — normaliseForAnalysis (BEN-40).
 * Pure unit tests — no API calls required.
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { normaliseForAnalysis } from "../../transcript/index.js";

describe("normaliseForAnalysis", () => {
  it("returns plain text for a sufficiently long txt transcript", async () => {
    const transcript = "This is a meeting transcript that is long enough to be valid for analysis purposes.";
    const result = await normaliseForAnalysis(transcript, { format: "txt" });
    assert.equal(result.text, transcript.trim());
  });

  it("defaults to txt format", async () => {
    const transcript = "This is a meeting transcript that is long enough to be valid for analysis purposes.";
    const result = await normaliseForAnalysis(transcript);
    assert.equal(result.text, transcript.trim());
  });

  it("throws when transcript is too short", async () => {
    await assert.rejects(
      () => normaliseForAnalysis("Too short."),
      /transcript too short/i
    );
  });

  it("parses whisper_json and returns plain text", async () => {
    const json = JSON.stringify({
      segments: [
        { text: "We are discussing the new machine learning model architecture.", start: 0, end: 5 },
        { text: "The technical challenge is achieving sub-50ms inference latency.", start: 5, end: 10 },
      ],
    });
    const result = await normaliseForAnalysis(json, { format: "whisper_json" });
    assert.ok(result.text.includes("machine learning"), "Expected joined segment text");
    assert.ok(typeof result.text === "string");
  });

  it("throws on malformed whisper_json", async () => {
    await assert.rejects(
      () => normaliseForAnalysis("not-valid-json", { format: "whisper_json" }),
      /whisper_json/i
    );
  });
});
