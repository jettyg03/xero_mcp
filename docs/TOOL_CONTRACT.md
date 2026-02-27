# Tool registration pattern (BEN-11)

All R&D Tax AI skill tools exposed by this MCP server must conform to this interface.

## Contract

- **name** (string): Tool name, e.g. `ingest_xero_data`, `categorise_transaction`
- **description** (string): What the tool does
- **inputSchema**: JSON Schema (or Zod shape) for validated input
- **output**: Must include primary result plus **confidence** (0–1), **flagForReview** (boolean), **flagReason?** (string, optional)

## Tool names (orchestration)

| Tool | Output type |
|------|-------------|
| `analyse_transcript` | ClientRDProfile |
| `ingest_xero_data` | Transaction[] |
| `research_vendor` | VendorProfile |
| `categorise_transaction` | CategorisedTransaction |
| `calculate_financials` | FinancialSummary |
| `generate_submission` | SubmissionDocument |

Skill definitions (inputs, outputs, behaviour) are documented in the **r-d_ti_ai** repo as .md files.
