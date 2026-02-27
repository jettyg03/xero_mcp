/**
 * Orchestration pipeline — constants, checkpoint triggers, and context helpers.
 *
 * This module defines the authoritative stage order, the rules that determine
 * when a human checkpoint fires, the prompt text shown at each checkpoint, and
 * a factory function for initialising a fresh PipelineContext.
 *
 * See docs/ORCHESTRATION.md for the full design spec and data flow diagram.
 * Linear: BEN-12.
 */

import type {
  PipelineStage,
  PipelineContext,
  CheckpointTrigger,
} from "./types.js";

export { PIPELINE_STAGE_ORDER } from "./types.js";

// ---------------------------------------------------------------------------
// Checkpoint configuration
// ---------------------------------------------------------------------------

/**
 * Defines when a checkpoint fires for each stage.
 * Stages without an entry in CHECKPOINT_TRIGGERS never pause automatically
 * (this should not occur — all stages should have an entry).
 */
export const CHECKPOINT_TRIGGERS: Record<PipelineStage, CheckpointTrigger> = {
  intake: {
    stage: "intake",
    mode: "always",
  },
  ingestion: {
    stage: "ingestion",
    mode: "always",
  },
  vendor_research: {
    stage: "vendor_research",
    // Only pause if vendor profiles are uncertain; routine lookups can pass through.
    mode: "conditional",
    minConfidence: 0.7,
    maxFlaggedRatio: 0,  // Any flagged vendor triggers review
  },
  categorisation: {
    stage: "categorisation",
    // Pause when any transaction needs human disambiguation.
    mode: "conditional",
    minConfidence: 0.7,
    maxFlaggedRatio: 0,  // Any "review_required" transaction triggers review
  },
  calculation: {
    stage: "calculation",
    mode: "always",  // Financial totals always require human sign-off
  },
  submission_generation: {
    stage: "submission_generation",
    mode: "always",  // Final mandatory review before filing
  },
};

// ---------------------------------------------------------------------------
// Checkpoint prompts — shown to the reviewer at each checkpoint
// ---------------------------------------------------------------------------

/**
 * Human-readable prompt shown at each checkpoint.
 * These guide the reviewer on what to look for and what decisions to make.
 */
export const CHECKPOINT_PROMPTS: Record<PipelineStage, string> = {
  intake:
    "Review the extracted R&D client profile. Confirm that the identified " +
    "R&D activities, technical challenges, key personnel, and financial year " +
    "are accurate before the financial pipeline runs.",

  ingestion:
    "Review the ingested Xero transactions. Check any flagged items (zero " +
    "amounts, missing descriptions, foreign currency). Confirm the date range " +
    "covers the full financial year.",

  vendor_research:
    "Review vendor profiles. Flag any vendors where the R&D eligibility " +
    "determination looks incorrect, or where more context is needed before " +
    "categorisation.",

  categorisation:
    "Review transaction categorisations. Resolve all 'review_required' items " +
    "and assign them to eligible_rd, supporting_rd, or non_eligible. " +
    "Spot-check a sample of auto-categorised transactions.",

  calculation:
    "Review the financial summary. Verify the total eligible expenditure, " +
    "eligible/non-eligible split, and estimated RDTI offset before the " +
    "submission narrative is drafted.",

  submission_generation:
    "Final review: read the complete submission document in full. Approve to " +
    "hand off to the tax preparer. Reject to revise any section.",
};

// ---------------------------------------------------------------------------
// Context factory
// ---------------------------------------------------------------------------

/**
 * Initialise a fresh PipelineContext for a new client engagement.
 *
 * @param clientId       Stable identifier for the client (e.g. Xero tenant ID).
 * @param financialYear  Australian financial year integer (e.g. 2024 = FY2024).
 */
export function createPipelineContext(
  clientId: string,
  financialYear: number
): PipelineContext {
  return {
    clientId,
    financialYear,
    startedAt: new Date().toISOString(),
    stages: {},
    checkpoints: [],
  };
}

// ---------------------------------------------------------------------------
// Checkpoint evaluation helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when a checkpoint should fire for the given stage, based on
 * the trigger configuration and the quality of the stage's output.
 *
 * @param stage           The stage that just completed.
 * @param confidence      Aggregate confidence score from the stage output.
 * @param flaggedRatio    Ratio of flagged items to total items (0–1). For
 *                        single-item outputs, use 1 if flagged, 0 otherwise.
 */
export function shouldFireCheckpoint(
  stage: PipelineStage,
  confidence: number,
  flaggedRatio: number
): boolean {
  const trigger = CHECKPOINT_TRIGGERS[stage];

  if (trigger.mode === "always") return true;

  // Conditional — fire when quality thresholds are not met
  const confidenceTooLow =
    trigger.minConfidence !== undefined && confidence < trigger.minConfidence;
  const tooManyFlagged =
    trigger.maxFlaggedRatio !== undefined && flaggedRatio > trigger.maxFlaggedRatio;

  return confidenceTooLow || tooManyFlagged;
}
