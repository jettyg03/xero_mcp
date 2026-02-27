/**
 * Normalises different transcript input formats to plain text.
 * Supports: plain text, Whisper-style JSON, and base64-encoded docx.
 * Linear: BEN-26.
 */

export type TranscriptFormat = "txt" | "whisper_json" | "docx_base64";

/** Top-level shape of OpenAI Whisper (and compatible) transcript JSON. */
interface WhisperOutput {
  text?: string;
  segments?: Array<{ text?: string; start?: number; end?: number }>;
}

/**
 * Normalise a transcript from any supported format to plain text.
 * Throws a descriptive error if content cannot be parsed in the declared format.
 */
export async function normaliseTranscript(
  content: string,
  format: TranscriptFormat = "txt"
): Promise<string> {
  switch (format) {
    case "txt":
      return content.trim();

    case "whisper_json":
      return normaliseWhisperJson(content);

    case "docx_base64":
      return normaliseDocxBase64(content);

    default: {
      // Exhaustiveness guard
      const _never: never = format;
      throw new Error(`Unknown transcript format: ${String(_never)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Format-specific handlers
// ---------------------------------------------------------------------------

function normaliseWhisperJson(content: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("whisper_json: content is not valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("whisper_json: expected a JSON object or array");
  }

  // Case 1: top-level { text: "..." }
  const asOutput = parsed as WhisperOutput;
  if (typeof asOutput.text === "string" && asOutput.text.trim()) {
    return asOutput.text.trim();
  }

  // Case 2: segments array (direct array or nested under .segments)
  const segments: Array<{ text?: string }> = Array.isArray(parsed)
    ? (parsed as Array<{ text?: string }>)
    : (asOutput.segments ?? []);

  if (segments.length === 0) {
    throw new Error(
      "whisper_json: expected a top-level 'text' field or a non-empty 'segments' array"
    );
  }

  const joined = segments
    .map((s) => s.text?.trim() ?? "")
    .filter(Boolean)
    .join(" ");

  if (!joined) {
    throw new Error("whisper_json: all segments have empty text");
  }

  return joined;
}

async function normaliseDocxBase64(content: string): Promise<string> {
  // Validate base64 before trying to decode
  if (!/^[A-Za-z0-9+/\s]+=*$/.test(content)) {
    throw new Error("docx_base64: content does not appear to be valid base64");
  }

  const buffer = Buffer.from(content.replace(/\s/g, ""), "base64");

  // Dynamic import so that mammoth is only loaded when actually needed
  const mammoth = await import("mammoth");
  const result = await mammoth.default.extractRawText({ buffer });

  const errors = (result.messages ?? []).filter((m) => m.type === "error");
  if (errors.length > 0) {
    throw new Error(
      `docx_base64: extraction errors: ${errors.map((e) => e.message).join("; ")}`
    );
  }

  const text = result.value.trim();
  if (!text) {
    throw new Error("docx_base64: extracted document has no text content");
  }

  return text;
}
