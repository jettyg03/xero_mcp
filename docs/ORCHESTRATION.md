# R&D Tax AI — Orchestration Flow & Data Pipeline

This document describes the end-to-end orchestration of the R&D Tax AI agent — how Claude invokes each skill in sequence, how data is passed between skills, and where human review checkpoints sit.

Linear: **BEN-12** | Project: R&D Tax AI — MCP Server & Architecture

---

## Overview

The pipeline transforms two raw inputs — a client meeting transcript and a Xero financial export — into a complete, lodgeable RDTI submission document. Claude orchestrates the pipeline by invoking MCP tools in sequence, propagating structured outputs from one stage as inputs to the next.

Each stage emits a `confidence` score and a `flagForReview` flag. These drive checkpoint decisions: low confidence or flagged outputs always pause for human review before the pipeline advances.

---

## Pipeline Stages

```
Stage 1  →  Stage 2  →  Stage 3  →  Stage 4  →  Stage 5  →  Stage 6
Intake      Ingestion   Vendor      Categorise  Calculate   Generate
                        Research    Transactions Financials  Submission
```

| # | Stage | MCP Tool | Primary Output |
|---|-------|----------|----------------|
| 1 | Client Intake | `analyse_transcript` | `ClientRDProfile` |
| 2 | Financial Ingestion | `ingest_xero_data` | `NormalisedTransaction[]` |
| 3 | Vendor Research | `research_vendor` | `VendorProfile[]` |
| 4 | Transaction Categorisation | `categorise_transaction` | `CategorisedTransaction[]` |
| 5 | Financial Calculation | `calculate_financials` | `FinancialSummary` |
| 6 | Submission Generation | `generate_submission` | `SubmissionDocument` |

A human review checkpoint follows every stage. Checkpoints after stages 3 and 4 are conditional (see [Checkpoint Rules](#checkpoint-rules)).

---

## Data Flow Diagram

```mermaid
flowchart TD
    %% Inputs
    T([Meeting Transcript\ntxt / whisper_json / docx_base64])
    X([Xero API\ntenantId + financialYear])

    %% Stage 1
    T --> AT["Stage 1\nanalyse_transcript"]
    AT --> CP1{{"⚑ CP1 — Review\nR&D profile"}}

    %% Stage 2
    CP1 -->|Approved| IXD["Stage 2\ningest_xero_data"]
    X --> IXD
    IXD --> CP2{{"⚑ CP2 — Review\ntransactions"}}

    %% Stage 3
    CP2 -->|Approved| RV["Stage 3\nresearch_vendor\n× unique vendors"]
    RV --> CP3{{"⚑ CP3 — Review\nvendor profiles\n(if flagged)"}}

    %% Stage 4
    CP3 -->|Approved| CAT["Stage 4\ncategorise_transaction\n× transaction"]
    AT -.->|ClientRDProfile context| CAT
    RV -.->|VendorProfile lookup| CAT
    CAT --> CP4{{"⚑ CP4 — Review\ncategorisations\n(if flagged)"}}

    %% Stage 5
    CP4 -->|Approved| CALC["Stage 5\ncalculate_financials"]
    AT -.->|ClientRDProfile context| CALC
    CALC --> CP5{{"⚑ CP5 — Verify\nfinancial totals"}}

    %% Stage 6
    CP5 -->|Approved| GEN["Stage 6\ngenerate_submission"]
    AT -.->|ClientRDProfile context| GEN
    CAT -.->|CategorisedTransaction[]| GEN
    GEN --> CP6{{"⚑ CP6 — Final review\nbefore filing"}}

    CP6 -->|Approved| DONE([Submission filed])

    %% Rejection paths
    CP1 -->|Rejected / revised| AT
    CP2 -->|Rejected / revised| IXD
    CP3 -->|Rejected| RV
    CP4 -->|Rejected| CAT
    CP5 -->|Rejected| CALC
    CP6 -->|Rejected| GEN

    style CP1 fill:#f5a623,color:#000
    style CP2 fill:#f5a623,color:#000
    style CP3 fill:#f5a623,color:#000
    style CP4 fill:#f5a623,color:#000
    style CP5 fill:#f5a623,color:#000
    style CP6 fill:#f5a623,color:#000
    style DONE fill:#27ae60,color:#fff
```

> Solid arrows = primary data flow. Dashed arrows = context passed from earlier stages.

---

## Stage Details

### Stage 1 — Client Intake

**Tool:** `analyse_transcript` (normalisation only — see BEN-40)

Stage 1 is a two-step process:

1. **MCP tool call** — normalises the raw input to plain text
2. **CoWork extraction** — Claude reads the `analyse_transcript` skill doc and extracts `ClientRDProfile` directly from the normalised text

**Tool inputs:**

| Field | Source | Notes |
|-------|--------|-------|
| `transcript` | User-supplied | Raw text, Whisper JSON, or base64 DOCX |
| `format` | User-supplied | `txt` \| `whisper_json` \| `docx_base64` |

**Tool output:** Plain text

```typescript
{
  text: string   // Normalised plain-text transcript
}
```

**CoWork extraction output:** `ClientRDProfile`

```typescript
{
  clientName?: string,
  industry: string,
  rdActivities: RDActivity[],
  technologies: string[],
  keyPersonnel: PersonnelMember[],
  spendingDiscussions: SpendingItem[],
  claimYear?: string,
  extractedAt: string,      // ISO 8601
  confidence: number,        // 0.3–0.9 per skill doc scoring rules
  flagForReview: boolean,
  flagReason?: string
}
```

**Checkpoint trigger:** Always — this is the foundation of the claim. Human must confirm that identified R&D activities, technical challenges, and financial year are accurate before the financial pipeline runs.

---

### Stage 2 — Financial Ingestion

**Tool:** `ingest_xero_data`

**Inputs:**

| Field | Source | Notes |
|-------|--------|-------|
| `tenantId` | User-supplied | Xero organisation ID |
| `financialYear` | From `ClientRDProfile.claimYear` | Parsed to integer (e.g. "FY2024" → `2024`) |
| `includeAttachments` | Config | `true` by default — fetches receipts/invoices |

**Output:** `NormalisedTransaction[]` (wrapped in `CallToolResult`)

```typescript
{
  transactions: NormalisedTransaction[],
  count: number,
  flaggedCount: number,
  confidence: number,           // Aggregate across all transactions
  flagForReview: boolean,
  flagReason?: string
}
```

**Checkpoint trigger:** Always, plus mandatory if `flaggedCount > 0`. Human reviews count, date range coverage, and any flagged transactions (zero amounts, missing descriptions, foreign currency).

---

### Stage 3 — Vendor Research

**Tool:** `research_vendor` *(BEN-20 → BEN-23, not yet implemented)*

**Inputs:** Extracted from Stage 2 output — deduplicated list of unique `contactName` values from `NormalisedTransaction[]`.

**Tool called per vendor:**

| Field | Source |
|-------|--------|
| `vendorName` | `transaction.contactName` |
| `vendorDomain` | Inferred from vendor name (optional) |
| `industry` | From `ClientRDProfile.industry` |

**Output:** `VendorProfile[]` stored as a map `vendorName → VendorProfile`

```typescript
{
  vendorName: string,
  isRdEligible: boolean,
  rationale: string,
  confidence: number,
  flagForReview: boolean,
  flagReason?: string
}
```

**Parallelism:** All vendor lookups are dispatched concurrently (via `Promise.allSettled`). Failed lookups produce a low-confidence stub, not a pipeline failure.

**Checkpoint trigger:** Conditional — only if any `VendorProfile.flagForReview === true` or `confidence < 0.7`. Human reviews misidentified vendors or those where eligibility determination was uncertain.

---

### Stage 4 — Transaction Categorisation

**Tool:** `categorise_transaction` *(BEN-28 → BEN-31, not yet implemented)*

**Inputs:** Called once per `NormalisedTransaction`.

| Field | Source |
|-------|--------|
| `transaction` | `NormalisedTransaction` from Stage 2 |
| `clientProfile` | `ClientRDProfile` from Stage 1 |
| `vendorProfile` | Matching `VendorProfile` from Stage 3 (if available) |

**Output:** `CategorisedTransaction`

```typescript
{
  transactionId: string,
  category: "eligible_rd" | "supporting_rd" | "non_eligible" | "review_required",
  rationale: string,
  confidence: number,
  flagForReview: boolean,
  flagReason?: string
}
```

**Category definitions:**

| Category | Meaning |
|----------|---------|
| `eligible_rd` | Directly incurred in conducting core R&D activities |
| `supporting_rd` | Directly related supporting activities (ATO TR 2019/1 §§ 66–80) |
| `non_eligible` | Routine development, sales, admin, or excluded expenditure |
| `review_required` | Ambiguous — human decision required |

**Checkpoint trigger:** Conditional — only if any transaction is `review_required`, `flagForReview === true`, or batch confidence < 0.7. Human spot-checks the eligible/ineligible split and resolves ambiguous items.

---

### Stage 5 — Financial Calculation

**Tool:** `calculate_financials` *(BEN-32 → BEN-34, not yet implemented)*

**Inputs:**

| Field | Source |
|-------|--------|
| `categorisedTransactions` | `CategorisedTransaction[]` from Stage 4 |
| `clientProfile` | `ClientRDProfile` from Stage 1 |

**Output:** `FinancialSummary`

```typescript
{
  totalRdExpenditure: number,      // Sum of eligible_rd + supporting_rd amounts
  currency: "AUD",
  breakdown: {
    eligible_rd: number,
    supporting_rd: number,
    non_eligible: number
  },
  estimatedRdtiOffset: number,     // At applicable rate (43.5% / 38.5%)
  claimYear: string,               // e.g. "FY2024"
  confidence: number,
  flagForReview: boolean,
  flagReason?: string
}
```

**Checkpoint trigger:** Always — the financial totals directly determine the claim value. Human verifies expenditure amounts, the eligible/ineligible split, and the estimated RDTI offset before the submission is drafted.

---

### Stage 6 — Submission Generation

**Tool:** `generate_submission` *(BEN-35 → BEN-39, not yet implemented)*

**Inputs:**

| Field | Source |
|-------|--------|
| `clientProfile` | `ClientRDProfile` from Stage 1 |
| `financialSummary` | `FinancialSummary` from Stage 5 |
| `categorisedTransactions` | `CategorisedTransaction[]` from Stage 4 |

**Output:** `SubmissionDocument`

```typescript
{
  title: string,
  sections: {
    companyOverview: string,
    rdActivities: string,         // Narrative per activity
    technicalChallenge: string,   // Why each activity involved genuine uncertainty
    expenditureSummary: string,   // Human-readable financial breakdown
    atoSchedules: string          // Machine-readable schedules for lodgement
  },
  generatedAt: string,            // ISO 8601
  confidence: number,
  flagForReview: boolean,
  flagReason?: string
}
```

**Checkpoint trigger:** Always — this is the final mandatory review. Human reads the complete submission before it is lodged. No automated action follows approval; the document is handed to the preparer.

---

## Checkpoint Rules

### Trigger conditions

| Checkpoint | Always fires | Fires conditionally when |
|------------|-------------|--------------------------|
| CP1 (after Stage 1) | ✅ | — |
| CP2 (after Stage 2) | ✅ | `flaggedCount > 0` triggers additional item-level review |
| CP3 (after Stage 3) | | Any `VendorProfile.flagForReview` or batch confidence < 0.7 |
| CP4 (after Stage 4) | | Any `category === "review_required"` or batch confidence < 0.7 |
| CP5 (after Stage 5) | ✅ | — |
| CP6 (after Stage 6) | ✅ | — |

### Checkpoint decisions

| Decision | Effect |
|----------|--------|
| `approved` | Pipeline advances to the next stage |
| `modified` | Human edits the output in place; pipeline advances with modified data |
| `rejected` | Stage is re-run (optionally with revised inputs) |

### Checkpoint prompt text

```
CP1 — Review the extracted R&D profile. Confirm R&D activities, technical
      challenges, key personnel, and financial year are accurate before
      financial data is ingested.

CP2 — Review ingested Xero transactions. Check flagged items (zero amounts,
      missing descriptions, foreign currency). Confirm the date range covers
      the full financial year.

CP3 — Review vendor profiles. Flag any vendors where the eligibility
      determination looks wrong or where more context is needed.

CP4 — Review transaction categorisations. Resolve all "review_required"
      items. Spot-check a sample of eligible and non-eligible categorisations.

CP5 — Review the financial summary. Verify total eligible expenditure,
      eligible/ineligible split, and estimated RDTI offset before the
      submission narrative is drafted.

CP6 — Final review: read the complete submission document. Approve to
      hand off to the tax preparer. Reject to revise any section.
```

---

## Data Carried Through the Pipeline

The `PipelineContext` object is the single shared state that Claude maintains across all stages. It accumulates outputs from each stage and is used to supply context inputs to later stages.

```typescript
interface PipelineContext {
  clientId: string;
  financialYear: number;
  startedAt: string;                                   // ISO 8601

  // Populated as the pipeline progresses
  clientProfile?:             AnalyseTranscriptResult;
  transactions?:              NormalisedTransaction[];
  vendorProfiles?:            Map<string, VendorProfile>;
  categorisedTransactions?:   CategorisedTransaction[];
  financialSummary?:          FinancialSummary;
  submissionDocument?:        SubmissionDocument;

  // Stage tracking
  stages:      Partial<Record<PipelineStage, PipelineStageStatus>>;
  checkpoints: HumanCheckpoint[];
}
```

See [`src/orchestration/types.ts`](../src/orchestration/types.ts) for the full type definitions.

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Stage returns `isError: true` | Pipeline halts; Claude surfaces the error to the user with context |
| Stage confidence < 0.5 | Force checkpoint before advancing |
| Vendor research fails for a vendor | Log stub with `flagForReview: true`; continue with remaining vendors |
| Checkpoint rejected | Re-run the stage; optionally accept revised user inputs |
| Attachment fetch fails | Transaction proceeds without attachments; individual transaction flagged |

---

## References

- **RDTI legislation:** Income Tax Assessment Act 1997, Div 355
- **ATO guidance:** Tax Ruling TR 2019/1 — *Income tax: research and development tax incentive*
- **Tool contract:** [`docs/TOOL_CONTRACT.md`](./TOOL_CONTRACT.md)
- **Skill definitions:** `r-d_ti_ai` repo — `analyse_transcript.md` and forthcoming skill `.md` files
- **E2E integration test:** BEN-14
