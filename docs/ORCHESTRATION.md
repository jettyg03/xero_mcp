# R&D Tax AI — Orchestration Flow & Data Pipeline

Design reference for tool implementers. Describes the end-to-end pipeline, the I/O contract between each stage, and the human review checkpoint rules.

> **Orchestration is the agent's responsibility.** Claude (CoWork) holds the pipeline state, decides which tool to call next, evaluates confidence, and pauses for human review. The MCP server exposes only atomic, stateless tools.
>
> For the agent-side skill instructions, see [`orchestration.md`](https://github.com/jettyg03/r-d_ti_ai_/blob/main/orchestration.md) in the `r-d_ti_ai` repo.

Linear: **BEN-12** | Project: R&D Tax AI — MCP Server & Architecture

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

## Stage I/O Reference

### Stage 1 — Client Intake

**Tool:** `analyse_transcript`

Stage 1 normalises the raw transcript to plain text. Claude then extracts `ClientRDProfile` directly from the normalised text using the `analyse_transcript` skill doc (see `r-d_ti_ai`).

**Tool inputs:**

| Field | Type | Notes |
|-------|------|-------|
| `transcript` | string | Raw text, Whisper JSON, or base64 DOCX |
| `format` | enum | `txt` \| `whisper_json` \| `docx_base64` |

**Tool output:** `{ text: string }` — normalised plain text.

**Claude extraction output:** `ClientRDProfile + { confidence, flagForReview, flagReason? }`

---

### Stage 2 — Financial Ingestion

**Tool:** `ingest_xero_data`

**Inputs:**

| Field | Type | Source |
|-------|------|--------|
| `tenantId` | string | User-supplied |
| `financialYear` | number | Parsed from `ClientRDProfile.claimYear` |
| `includeAttachments` | boolean | `true` (default) |

**Output:**

```
{
  transactions: NormalisedTransaction[],
  count: number,
  flaggedCount: number,
  confidence: number,
  flagForReview: boolean,
  flagReason?: string
}
```

---

### Stage 3 — Vendor Research

**Tool:** `research_vendor` *(BEN-20 → BEN-23)*

Called once per unique `contactName` from `NormalisedTransaction[]`. Concurrent via `Promise.allSettled` — failures produce a low-confidence stub, not a pipeline halt.

**Input per vendor:** `{ vendorName, industry }`

**Output:** `VendorProfile` — `{ vendorName, isRdEligible, rationale, confidence, flagForReview, flagReason? }`

---

### Stage 4 — Transaction Categorisation

**Tool:** `categorise_transaction` *(BEN-28 → BEN-31)*

Called once per transaction.

**Input:** `{ transaction: NormalisedTransaction, clientProfile: ClientRDProfile, vendorProfile?: VendorProfile }`

**Output:** `CategorisedTransaction`

```
{
  transactionId: string,
  category: "eligible_rd" | "supporting_rd" | "non_eligible" | "review_required",
  rationale: string,
  confidence: number,
  flagForReview: boolean,
  flagReason?: string
}
```

---

### Stage 5 — Financial Calculation

**Tool:** `calculate_financials` *(BEN-32 → BEN-34)*

**Input:** `{ categorisedTransactions: CategorisedTransaction[], clientProfile: ClientRDProfile }`

**Output:** `FinancialSummary`

```
{
  totalRdExpenditure: number,
  currency: "AUD",
  breakdown: { eligible_rd, supporting_rd, non_eligible },
  estimatedRdtiOffset: number,   // 43.5% (<$20M turnover) or 38.5%
  claimYear: string,
  confidence: number,
  flagForReview: boolean,
  flagReason?: string
}
```

---

### Stage 6 — Submission Generation

**Tool:** `generate_submission` *(BEN-35 → BEN-39)*

**Input:** `{ clientProfile: ClientRDProfile, financialSummary: FinancialSummary, categorisedTransactions: CategorisedTransaction[] }`

**Output:** `SubmissionDocument`

```
{
  title: string,
  sections: {
    companyOverview, rdActivities, technicalChallenge,
    expenditureSummary, atoSchedules
  },
  generatedAt: string,
  confidence: number,
  flagForReview: boolean,
  flagReason?: string
}
```

---

## Checkpoint Rules

These rules are enforced by the agent, not the MCP server. Documented here for reference when designing tools — tools must emit `confidence` and `flagForReview` to enable these decisions.

| Checkpoint | Fires when |
|------------|-----------|
| CP1 — after Stage 1 | Always |
| CP2 — after Stage 2 | Always; `flaggedCount > 0` adds item-level review |
| CP3 — after Stage 3 | Any `VendorProfile.flagForReview` or batch confidence < 0.7 |
| CP4 — after Stage 4 | Any `category === "review_required"` or batch confidence < 0.7 |
| CP5 — after Stage 5 | Always |
| CP6 — after Stage 6 | Always (mandatory before filing) |

---

## References

- **Agent skill instructions:** [`orchestration.md`](https://github.com/jettyg03/r-d_ti_ai_/blob/main/orchestration.md) in `r-d_ti_ai`
- **Tool contract:** [`docs/TOOL_CONTRACT.md`](./TOOL_CONTRACT.md)
- **ATO guidance:** Tax Ruling TR 2019/1
- **E2E integration test:** BEN-14
