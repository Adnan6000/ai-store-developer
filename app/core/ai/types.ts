export type SupportedProviderId =
  | "gemini"
  | "openai"
  | "anthropic"
  | "openrouter"
  | "builtin";

export type ProviderErrorClassification =
  | "AUTH_ERROR"
  | "QUOTA_OR_RATE_LIMIT"
  | "PROVIDER_UNAVAILABLE"
  | "MODEL_UNAVAILABLE"
  | "PERMISSION_DENIED"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE"
  | "UNKNOWN";

export type ProviderHealthStatus =
  | "HEALTHY"
  | "AUTH_ERROR"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "UNKNOWN";

export type PlanningMode = "STANDARD" | "REVIEWED";

export type PlanCategory =
  | "ANALYSIS"
  | "PRODUCT"
  | "COLLECTION"
  | "METAFIELD"
  | "METAOBJECT"
  | "THEME"
  | "SEO"
  | "CONTENT"
  | "APP_EXTENSION"
  | "PERFORMANCE"
  | "BUG_FIX"
  | "CUSTOM_CODE"
  | "SETTINGS"
  | "OTHER";

export type PlanOperationIntent =
  | "READ"
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "CODE_CHANGE"
  | "CONFIGURATION"
  | "EXTERNAL_ACTION"
  | "NONE";

export type OverallRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";
export type StepRiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type PlanStatus = "DRAFT" | "READY_FOR_REVIEW" | "APPROVED" | "REJECTED" | "FAILED";

export interface AiModelInfo {
  id: string;
  name: string;
  description?: string;
}

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  models?: AiModelInfo[];
}

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  category: PlanCategory;
  operationIntent: PlanOperationIntent;
  target: string;
  rationale: string;
  dependencies: string[];
  expectedOutcome: string;
  riskLevel: StepRiskLevel;
  reversible: boolean;
}

export interface ProviderAttempt {
  provider: SupportedProviderId;
  status: "SUCCESS" | "FAILED";
  errorClassification?: ProviderErrorClassification;
  message?: string;
}

export interface AiDevelopmentPlan {
  schemaVersion: number;
  planId: string;
  shop: string;
  createdAt: string;

  userRequest: string;

  summary: string;
  objective: string;

  providerExecution: {
    requestedMode: PlanningMode;
    effectiveMode: PlanningMode;
    primaryProvider: SupportedProviderId;
    reviewerProvider?: SupportedProviderId | null;
    fallbackOccurred: boolean;
    attempts: ProviderAttempt[];
  };

  contextReference: {
    snapshotId: string | null;
    analyzedAt: string | null;
  };

  knownFacts: string[];
  assumptions: string[];
  questions: string[];

  impactAreas: string[];

  proposedSteps: PlanStep[];

  requiredCapabilities: string[];

  warnings: string[];

  risk: {
    overall: OverallRiskLevel;
    reasons: string[];
  };

  approval: {
    required: boolean;
    status: PlanStatus;
  };
}

export interface SafeStoreContextProjection {
  shop: {
    domain: string;
    name: string;
    currency: string;
    primaryLocale: string;
    planName: string;
    isPlus: boolean;
  };
  catalog: {
    productCount: number;
    collectionCount: number;
    sampleDataDisclaimer: string;
    sampleTitles: string[];
    sampleProductTypes: string[];
    sampleVendors: string[];
    sampleStatusCounts: Record<string, number>;
  };
  customData: {
    metafieldDefinitions: Array<{
      namespace: string;
      key: string;
      name: string;
      typeName: string;
      ownerType: string;
      isAppOwned: boolean | "unknown";
    }>;
    metaobjectDefinitions: Array<{
      name: string;
      type: string;
      isAppOwned: boolean | "unknown";
      fieldKeys: string[];
    }>;
  };
  capabilities: {
    grantedScopes: string[];
    scopesRetrieved: boolean;
    themeContextAvailable: boolean | "unknown";
    themeContextMessage: string;
  };
  warnings: string[];
}

export interface PlanGenerationInput {
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  model?: string | null;
}

export interface PlanGenerationOutput {
  success: boolean;
  rawContent?: string;
  modelUsed?: string;
  errorClassification?: ProviderErrorClassification;
  errorMessage?: string;
}

export interface PlanReviewInput {
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  model?: string | null;
}

export interface StructuredPlanReview {
  reviewVerdict: "APPROVED_AS_IS" | "MODIFICATIONS_SUGGESTED" | "CONCERNS_IDENTIFIED";
  critiqueSummary: string;
  additionalAssumptions: string[];
  additionalQuestions: string[];
  additionalWarnings: string[];
  suggestedStepModifications: string[];
}

export interface PlanReviewOutput {
  success: boolean;
  review?: StructuredPlanReview;
  modelUsed?: string;
  errorClassification?: ProviderErrorClassification;
  errorMessage?: string;
}

export interface AiProvider {
  id: SupportedProviderId;
  name: string;
  description: string;
  isEnabled: boolean;
  validateCredentials(apiKey: string): Promise<ValidationResult>;
  getModels?(apiKey: string): Promise<AiModelInfo[]>;
  generatePlan?(input: PlanGenerationInput): Promise<PlanGenerationOutput>;
  reviewPlan?(input: PlanReviewInput): Promise<PlanReviewOutput>;
}

export interface ProviderConnectionSummary {
  id: SupportedProviderId;
  name: string;
  description: string;
  isEnabled: boolean;
  isConnected: boolean;
  isActive: boolean;
  lastFour?: string;
  lastValidatedAt?: string | null;
  activeModel?: string | null;
  availableModels?: AiModelInfo[];
}

/**
 * Validation bounds for AI-generated plan content.
 * All limits are enforced server-side regardless of what the model produces.
 */
export const PLAN_VALIDATION_BOUNDS = {
  MAX_STEPS: 50,
  MAX_SUMMARY_LENGTH: 500,
  MAX_OBJECTIVE_LENGTH: 500,
  MAX_STEP_TITLE_LENGTH: 200,
  MAX_STEP_DESCRIPTION_LENGTH: 2000,
  MAX_STRING_ARRAY_ITEMS: 30,
  MAX_STRING_ITEM_LENGTH: 500,
  MAX_DEPENDENCY_DEPTH: 10,
} as const;

/**
 * The shape the AI model must produce.
 * This is the raw (untrusted) content parsed from the model response.
 * Server-side metadata (planId, shop, createdAt, providerExecution, etc.)
 * is NEVER sourced from this type — it is constructed by the server.
 */
export interface AiGeneratedPlanContent {
  summary: string;
  objective: string;
  knownFacts: string[];
  assumptions: string[];
  questions: string[];
  impactAreas: string[];
  proposedSteps: Array<{
    id?: string;
    title: string;
    description: string;
    category: string;
    operationIntent: string;
    target: string;
    rationale: string;
    dependencies: string[];
    expectedOutcome: string;
    riskLevel: string;
    reversible: boolean;
  }>;
  requiredCapabilities: string[];
  warnings: string[];
  risk?: {
    reasons: string[];
  };
}
