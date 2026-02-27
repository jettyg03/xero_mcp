/**
 * Orchestration layer types — pipeline state, checkpoints, and stage contracts.
 *
 * These types describe the shared context that Claude maintains across all
 * pipeline stages, the human review checkpoints between stages, and the status
 * of each stage as the pipeline progresses.
 *
 * See docs/ORCHESTRATION.md for the full design spec and data flow diagram.
 * Linear: BEN-12.
 */

import type { NormalisedTransaction } from "../xero/normalise.js";
import type {
  ClientRDProfile,
  VendorProfile,
  CategorisedTransaction,
  FinancialSummary,
  SubmissionDocument,
} from "../types.js";

// ---------------------------------------------------------------------------
// Pipeline stages (in execution order)
// ---------------------------------------------------------------------------

export type PipelineStage =
  | "intake"             // analyse_transcript      → ClientRDProfile
  | "ingestion"          // ingest_xero_data         → NormalisedTransaction[]
  | "vendor_research"    // research_vendor × N      → VendorProfile[]
  | "categorisation"     // categorise_transaction × N → CategorisedTransaction[]
  | "calculation"        // calculate_financials     → FinancialSummary
  | "submission_generation"; // generate_submission  → SubmissionDocument

/** Ordered list of all pipeline stages. */
export const PIPELINE_STAGE_ORDER: PipelineStage[] = [
  "intake",
  "ingestion",
  "vendor_research",
  "categorisation",
  "calculation",
  "submission_generation",
];

// ---------------------------------------------------------------------------
// Stage status
// ---------------------------------------------------------------------------

export type StageStatus =
  | "pending"           // Not yet started
  | "in_progress"       // Tool call(s) running
  | "awaiting_review"   // Checkpoint fired — waiting for human decision
  | "approved"          // Checkpoint passed; stage output accepted
  | "complete"          // Stage done and pipeline has advanced past it
  | "failed";           // Unrecoverable error

export interface PipelineStageStatus {
  status: StageStatus;
  startedAt?: string;       // ISO 8601
  completedAt?: string;     // ISO 8601
  confidence?: number;      // Aggregate confidence for this stage's output
  flagForReview?: boolean;
  flagReason?: string;
  /** Human-readable error if status === "failed". */
  error?: string;
}

// ---------------------------------------------------------------------------
// Human checkpoints
// ---------------------------------------------------------------------------

export type CheckpointDecision = "approved" | "modified" | "rejected";

export interface HumanCheckpoint {
  stage: PipelineStage;
  decision: CheckpointDecision;
  /** Free-text notes from the reviewer (e.g. corrections made). */
  notes?: string;
  decidedAt: string;  // ISO 8601
  decidedBy?: string; // User identifier
}

/**
 * Defines when a checkpoint fires for a given stage.
 * "always" = checkpoint runs regardless of output quality.
 * "conditional" = checkpoint fires only when quality thresholds are not met.
 */
export type CheckpointMode = "always" | "conditional";

export interface CheckpointTrigger {
  stage: PipelineStage;
  mode: CheckpointMode;
  /**
   * For conditional checkpoints — fires when any of these are true:
   * - stage output confidence < minConfidence
   * - any item in the output has flagForReview === true
   * - flaggedRatio exceeds maxFlaggedRatio (for batch outputs)
   */
  minConfidence?: number;
  maxFlaggedRatio?: number;
}

// ---------------------------------------------------------------------------
// Pipeline context — shared state passed through all stages
// ---------------------------------------------------------------------------

/**
 * The single shared state maintained by Claude across all pipeline stages.
 * Each stage reads from this context and writes its output back into it.
 */
export interface PipelineContext {
  /** Stable identifier for the client (e.g. Xero tenant ID or internal ID). */
  clientId: string;
  /** Australian financial year (e.g. 2024 = FY2024: 1 Jul 2023 – 30 Jun 2024). */
  financialYear: number;
  /** ISO 8601 timestamp when the pipeline was initiated. */
  startedAt: string;

  // ── Stage outputs (populated as pipeline progresses) ────────────────────

  /**
   * Stage 1 output — produced by Claude (CoWork) reading the normalised
   * transcript against the analyse_transcript skill doc. The MCP tool only
   * normalises format; extraction is done by the LLM directly.
   */
  clientProfile?: ClientRDProfile;
  /** Stage 2 output. */
  transactions?: NormalisedTransaction[];
  /**
   * Stage 3 output.
   * Keyed by vendor name (NormalisedTransaction.contactName) for O(1) lookup
   * during Stage 4 categorisation.
   */
  vendorProfiles?: Map<string, VendorProfile>;
  /** Stage 4 output. */
  categorisedTransactions?: CategorisedTransaction[];
  /** Stage 5 output. */
  financialSummary?: FinancialSummary;
  /** Stage 6 output. */
  submissionDocument?: SubmissionDocument;

  // ── Stage & checkpoint tracking ─────────────────────────────────────────

  /** Keyed by PipelineStage — updated in place as each stage runs. */
  stages: Partial<Record<PipelineStage, PipelineStageStatus>>;
  /** Ordered list of all checkpoint decisions made so far. */
  checkpoints: HumanCheckpoint[];
}

// ---------------------------------------------------------------------------
// Pipeline result
// ---------------------------------------------------------------------------

/**
 * Returned by the pipeline runner at any point — whether a stage completed,
 * a checkpoint fired, or an error occurred.
 */
export interface PipelineResult {
  context: PipelineContext;
  /** True only when all six stages have completed and CP6 has been approved. */
  complete: boolean;
  /** The stage that was most recently active. */
  currentStage: PipelineStage;
  /** True when the pipeline is paused at a human checkpoint. */
  awaitingCheckpoint: boolean;
  /** Present when the pipeline halted due to an error. */
  error?: string;
}
