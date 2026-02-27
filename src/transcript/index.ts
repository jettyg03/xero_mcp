/**
 * Transcript normalisation: accepts multi-format input, returns plain text.
 * Extraction and enrichment have been moved to the calling skill (CoWork).
 * Linear: BEN-40.
 */

export type { TranscriptFormat } from "./normaliser.js";
import { normaliseTranscript, type TranscriptFormat } from "./normaliser.js";

export interface NormaliseTranscriptOptions {
  format?: TranscriptFormat;
}

export interface NormaliseTranscriptResult {
  text: string;
}

const MIN_TRANSCRIPT_LENGTH = 50;

/**
 * Normalise a transcript from any supported format to plain text.
 * Throws if the resulting text is too short to be useful.
 */
export async function normaliseForAnalysis(
  content: string,
  options: NormaliseTranscriptOptions = {}
): Promise<NormaliseTranscriptResult> {
  const { format = "txt" } = options;
  const text = await normaliseTranscript(content, format);

  if (text.length < MIN_TRANSCRIPT_LENGTH) {
    throw new Error(
      `Transcript too short (${text.length} chars). Minimum is ${MIN_TRANSCRIPT_LENGTH}.`
    );
  }

  return { text };
}
