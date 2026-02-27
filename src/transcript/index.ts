/**
 * Transcript analysis pipeline: normalise → extract → [enrich].
 * Exported for direct use by the analyse_transcript MCP tool handler.
 * Linear: BEN-24, BEN-25, BEN-26.
 */

export type { ClientRDProfile, IndustryEnrichment, RDActivity, SpendingItem, PersonnelMember } from "./types.js";
export type { TranscriptFormat } from "./normaliser.js";

import type { ClientRDProfile } from "./types.js";
import { normaliseTranscript, type TranscriptFormat } from "./normaliser.js";
import { extractRDProfile, scoreConfidence } from "./extractor.js";
import { enrichWithIndustryContext } from "./enricher.js";

export interface AnalyseTranscriptOptions {
  format?: TranscriptFormat;
  /** Whether to run industry enrichment after extraction (default: true). */
  enrich?: boolean;
  /** Anthropic API key. Falls back to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
}

export interface AnalyseTranscriptResult {
  profile: ClientRDProfile;
  confidence: number;
  flagForReview: boolean;
  flagReason?: string;
}

const MIN_TRANSCRIPT_LENGTH = 50;

/**
 * Run the full transcript analysis pipeline:
 * 1. Normalise to plain text (handles txt, whisper_json, docx_base64)
 * 2. Extract structured R&D profile via Claude
 * 3. Optionally enrich with industry-specific ATO context
 *
 * Enrichment failures are non-fatal: the profile is returned without
 * enrichment and flagged for human review.
 */
export async function analyseTranscript(
  content: string,
  options: AnalyseTranscriptOptions = {}
): Promise<AnalyseTranscriptResult> {
  const { format = "txt", enrich = true, apiKey } = options;

  // Step 1: Normalise
  const plainText = await normaliseTranscript(content, format);

  if (plainText.length < MIN_TRANSCRIPT_LENGTH) {
    return {
      profile: emptyProfile(),
      confidence: 0,
      flagForReview: true,
      flagReason: `Transcript too short (${plainText.length} chars). Minimum is ${MIN_TRANSCRIPT_LENGTH}.`,
    };
  }

  // Step 2: Extract structured profile
  const extracted = await extractRDProfile(plainText, { apiKey });

  // Step 3: Enrich (optional)
  let industryEnrichment: ClientRDProfile["industryEnrichment"] = undefined;
  if (enrich) {
    try {
      industryEnrichment = await enrichWithIndustryContext(extracted, {
        apiKey,
      });
    } catch (err) {
      // Enrichment failure is non-fatal; caller will see flagForReview=true
      process.stderr.write(
        `analyse_transcript: enrichment failed — ${String(err)}\n`
      );
    }
  }

  const profile: ClientRDProfile = {
    ...extracted,
    industryEnrichment,
    extractedAt: new Date().toISOString(),
  };

  const scoring = scoreConfidence(extracted);

  // Downgrade confidence slightly if enrichment was requested but failed
  const confidence =
    enrich && !industryEnrichment
      ? Math.max(0, scoring.confidence - 0.1)
      : scoring.confidence;

  const flagReason = [
    scoring.flagReason,
    enrich && !industryEnrichment ? "industry enrichment unavailable" : null,
  ]
    .filter(Boolean)
    .join("; ");

  return {
    profile,
    confidence,
    flagForReview: confidence < 0.6 || (enrich && !industryEnrichment),
    flagReason: flagReason || undefined,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyProfile(): ClientRDProfile {
  return {
    industry: "Unknown",
    rdActivities: [],
    technologies: [],
    keyPersonnel: [],
    spendingDiscussions: [],
    extractedAt: new Date().toISOString(),
  };
}
