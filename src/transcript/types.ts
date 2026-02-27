/**
 * Output types for the analyse_transcript MCP tool.
 * Linear: BEN-24.
 */

/** A discrete R&D activity described in the transcript. */
export interface RDActivity {
  /** Short title for the activity. */
  title: string;
  /** What is being developed, researched, or improved. */
  description: string;
  /** The technical uncertainty or problem being addressed. */
  technicalChallenge?: string;
  /** Development stage at the time of the meeting. */
  stage?: "research" | "experimental_development" | "testing" | "production";
}

export interface PersonnelMember {
  name?: string;
  role?: string;
}

export interface SpendingItem {
  /** Expense category (e.g. "salaries", "contractors", "cloud infrastructure"). */
  category: string;
  estimatedAmount?: number;
  currency?: string;
  notes?: string;
}

export interface IndustryEnrichment {
  /** Standardised sector label (e.g. "Information Technology", "Pharmaceutical Research"). */
  sector: string;
  /** Common R&D activities in this sector that are eligible for RDTI. */
  typicalRDActivities: string[];
  /** Summary of ATO guidance relevant to R&D claims in this sector. */
  atoGuidance: string;
  /** Tips for categorising R&D expenditure in this sector. */
  categorisationNotes: string;
}

/**
 * Structured R&D client profile extracted from a meeting transcript.
 * Primary output of the analyse_transcript MCP tool.
 */
export interface ClientRDProfile {
  /** Client or company name, if mentioned. */
  clientName?: string;
  /** Primary industry or sector. */
  industry: string;
  /** Discrete R&D activities described during the meeting. */
  rdActivities: RDActivity[];
  /** Technologies, frameworks, tools, and methodologies mentioned. */
  technologies: string[];
  /** Key personnel mentioned (researchers, developers, leads, etc.). */
  keyPersonnel: PersonnelMember[];
  /** R&D spending or budget discussions. */
  spendingDiscussions: SpendingItem[];
  /** Financial year the claim relates to (e.g. "FY2024"). */
  claimYear?: string;
  /** Industry-specific enrichment from external research. Present when enrich=true. */
  industryEnrichment?: IndustryEnrichment;
  /** ISO 8601 timestamp when this profile was extracted. */
  extractedAt: string;
}
