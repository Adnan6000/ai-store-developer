import crypto from "node:crypto";
import type {
  AiDevelopmentPlan,
  OverallRiskLevel,
  PlanCategory,
  PlanOperationIntent,
  PlanningMode,
  PlanStep,
  ProviderAttempt,
  StepRiskLevel,
  SupportedProviderId,
} from "./types";
import { PLAN_VALIDATION_BOUNDS } from "./types";

const ALLOWED_CATEGORIES: readonly PlanCategory[] = [
  "ANALYSIS",
  "PRODUCT",
  "COLLECTION",
  "METAFIELD",
  "METAOBJECT",
  "THEME",
  "SEO",
  "CONTENT",
  "APP_EXTENSION",
  "PERFORMANCE",
  "BUG_FIX",
  "CUSTOM_CODE",
  "SETTINGS",
  "OTHER",
] as const;

const ALLOWED_OPERATION_INTENTS: readonly PlanOperationIntent[] = [
  "READ",
  "CREATE",
  "UPDATE",
  "DELETE",
  "CODE_CHANGE",
  "CONFIGURATION",
  "EXTERNAL_ACTION",
  "NONE",
] as const;

const ALLOWED_STEP_RISKS: readonly StepRiskLevel[] = ["LOW", "MEDIUM", "HIGH"] as const;

export interface PlanValidationContext {
  shop: string;
  userRequest: string;
  requestedMode: PlanningMode;
  effectiveMode: PlanningMode;
  primaryProvider: SupportedProviderId;
  reviewerProvider?: SupportedProviderId | null;
  fallbackOccurred: boolean;
  attempts: ProviderAttempt[];
  contextSnapshotId: string | null;
  contextAnalyzedAt: string | null;
  grantedScopes: string[];
}

export interface PlanValidationResult {
  valid: boolean;
  plan?: AiDevelopmentPlan;
  errors?: string[];
}

/**
 * Extracts raw JSON from model text responses, stripping markdown code fences if present.
 */
export function extractJsonFromResponse(rawContent: string): unknown {
  if (!rawContent || typeof rawContent !== "string") {
    throw new Error("Empty model response received.");
  }

  let cleaned = rawContent.trim();

  // Strip markdown code block wrappers like ```json ... ``` or ``` ... ```
  const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonMatch && jsonMatch[1]) {
    cleaned = jsonMatch[1].trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    // If strict parse failed, attempt to find first '{' and last '}'
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const candidate = cleaned.slice(firstBrace, lastBrace + 1);
      return JSON.parse(candidate);
    }
    throw new Error("Failed to parse JSON from AI model response.");
  }
}

/**
 * Truncates a string to a maximum length with an ellipsis indicator.
 */
function truncateString(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

/**
 * Safely extracts and bounds a string array from untrusted input.
 */
function toBoundedStringArray(
  val: unknown,
  maxItems: number = PLAN_VALIDATION_BOUNDS.MAX_STRING_ARRAY_ITEMS,
  maxItemLen: number = PLAN_VALIDATION_BOUNDS.MAX_STRING_ITEM_LENGTH
): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .filter((item): item is string => typeof item === "string")
    .map((item) => truncateString(item.trim(), maxItemLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

/**
 * Detects circular dependencies in proposed steps.
 * Returns true if a cycle is detected.
 */
function hasCircularDependencies(
  steps: Array<{ id: string; dependencies: string[] }>
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const s of steps) {
    adjacency.set(s.id, s.dependencies);
  }

  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function hasCycle(nodeId: string, depth: number): boolean {
    if (depth > PLAN_VALIDATION_BOUNDS.MAX_DEPENDENCY_DEPTH) return true;
    if (recursionStack.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;

    visited.add(nodeId);
    recursionStack.add(nodeId);

    const deps = adjacency.get(nodeId) || [];
    for (const dep of deps) {
      if (hasCycle(dep, depth + 1)) return true;
    }

    recursionStack.delete(nodeId);
    return false;
  }

  for (const s of steps) {
    if (hasCycle(s.id, 0)) return true;
  }

  return false;
}

/**
 * Validates, normalizes, and applies server-side safety and risk classification to a model-generated plan.
 *
 * CRITICAL: Server-side metadata (planId, shop, createdAt, providerExecution, contextReference)
 * is ALWAYS constructed here from the PlanValidationContext. The AI model has NO influence
 * over these fields regardless of what it outputs.
 */
export function validateAndNormalizePlan(
  rawInput: unknown,
  context: PlanValidationContext
): PlanValidationResult {
  const errors: string[] = [];

  if (!rawInput || typeof rawInput !== "object") {
    return { valid: false, errors: ["Plan input is not a valid JSON object."] };
  }

  const raw = rawInput as Record<string, unknown>;

  // Validate summary and objective with bounds
  let summary = typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.trim() : "";
  if (!summary) {
    errors.push("Missing or invalid 'summary' field.");
  } else {
    summary = truncateString(summary, PLAN_VALIDATION_BOUNDS.MAX_SUMMARY_LENGTH);
  }

  let objective = typeof raw.objective === "string" && raw.objective.trim() ? raw.objective.trim() : "";
  if (!objective) {
    errors.push("Missing or invalid 'objective' field.");
  } else {
    objective = truncateString(objective, PLAN_VALIDATION_BOUNDS.MAX_OBJECTIVE_LENGTH);
  }

  // Validate proposedSteps with bounds
  if (!Array.isArray(raw.proposedSteps) || raw.proposedSteps.length === 0) {
    errors.push("Missing or empty 'proposedSteps' array.");
  } else if (raw.proposedSteps.length > PLAN_VALIDATION_BOUNDS.MAX_STEPS) {
    errors.push(
      `Plan contains ${raw.proposedSteps.length} steps, exceeding maximum of ${PLAN_VALIDATION_BOUNDS.MAX_STEPS}.`
    );
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Normalize steps with bounds enforcement
  const normalizedSteps: PlanStep[] = [];
  const rawSteps = (raw.proposedSteps as Array<Record<string, unknown>>).slice(
    0,
    PLAN_VALIDATION_BOUNDS.MAX_STEPS
  );

  let hasDeleteIntent = false;
  let hasWriteOrModifyIntent = false;
  let hasThemeChange = false;
  let hasMultipleDeleteSteps = false;
  let deleteStepCount = 0;

  for (let i = 0; i < rawSteps.length; i++) {
    const s = rawSteps[i];
    const stepId = typeof s.id === "string" && s.id.trim() ? s.id.trim() : `step-${i + 1}`;
    const title = truncateString(
      typeof s.title === "string" && s.title.trim() ? s.title.trim() : `Step ${i + 1}`,
      PLAN_VALIDATION_BOUNDS.MAX_STEP_TITLE_LENGTH
    );
    const description = truncateString(
      typeof s.description === "string" ? s.description.trim() : "",
      PLAN_VALIDATION_BOUNDS.MAX_STEP_DESCRIPTION_LENGTH
    );

    // Category
    let category: PlanCategory = "OTHER";
    if (typeof s.category === "string") {
      const upper = s.category.toUpperCase() as PlanCategory;
      if (ALLOWED_CATEGORIES.includes(upper)) {
        category = upper;
      }
    }

    // Operation intent
    let operationIntent: PlanOperationIntent = "READ";
    if (typeof s.operationIntent === "string") {
      const upper = s.operationIntent.toUpperCase() as PlanOperationIntent;
      if (ALLOWED_OPERATION_INTENTS.includes(upper)) {
        operationIntent = upper;
      }
    }

    if (operationIntent === "DELETE") {
      hasDeleteIntent = true;
      deleteStepCount++;
      if (deleteStepCount > 1) {
        hasMultipleDeleteSteps = true;
      }
    }
    if (["CREATE", "UPDATE", "DELETE", "CODE_CHANGE", "CONFIGURATION", "EXTERNAL_ACTION"].includes(operationIntent)) {
      hasWriteOrModifyIntent = true;
    }
    if (category === "THEME" || category === "CUSTOM_CODE") {
      hasThemeChange = true;
    }

    // Target, rationale, expectedOutcome (bounded)
    const target = truncateString(
      typeof s.target === "string" ? s.target.trim() : "Store",
      PLAN_VALIDATION_BOUNDS.MAX_STRING_ITEM_LENGTH
    );
    const rationale = truncateString(
      typeof s.rationale === "string" ? s.rationale.trim() : "",
      PLAN_VALIDATION_BOUNDS.MAX_STRING_ITEM_LENGTH
    );
    const expectedOutcome = truncateString(
      typeof s.expectedOutcome === "string" ? s.expectedOutcome.trim() : "",
      PLAN_VALIDATION_BOUNDS.MAX_STRING_ITEM_LENGTH
    );

    // Dependencies (bounded)
    const dependencies = Array.isArray(s.dependencies)
      ? s.dependencies
          .filter((d): d is string => typeof d === "string")
          .slice(0, PLAN_VALIDATION_BOUNDS.MAX_DEPENDENCY_DEPTH)
      : [];

    // Step risk level — server overrides to enforce safety
    let riskLevel: StepRiskLevel = "LOW";
    if (typeof s.riskLevel === "string") {
      const upper = s.riskLevel.toUpperCase() as StepRiskLevel;
      if (ALLOWED_STEP_RISKS.includes(upper)) {
        riskLevel = upper;
      }
    }
    // Server-side enforcement: DELETE is always HIGH risk at step level
    if (operationIntent === "DELETE" && riskLevel === "LOW") {
      riskLevel = "HIGH";
    }
    // Server-side enforcement: theme/custom code changes are at least MEDIUM
    if ((category === "THEME" || category === "CUSTOM_CODE") && riskLevel === "LOW") {
      riskLevel = "MEDIUM";
    }

    const reversible = typeof s.reversible === "boolean" ? s.reversible : operationIntent !== "DELETE";

    normalizedSteps.push({
      id: stepId,
      title,
      description,
      category,
      operationIntent,
      target,
      rationale,
      dependencies,
      expectedOutcome,
      riskLevel,
      reversible,
    });
  }

  // Detect circular dependencies
  if (hasCircularDependencies(normalizedSteps)) {
    // Strip all dependencies rather than rejecting the plan entirely
    for (const step of normalizedSteps) {
      step.dependencies = [];
    }
  }

  // Bounded string arrays
  const knownFacts = toBoundedStringArray(raw.knownFacts);
  const assumptions = toBoundedStringArray(raw.assumptions);
  const questions = toBoundedStringArray(raw.questions);
  const impactAreas = toBoundedStringArray(raw.impactAreas);
  const requiredCapabilities = toBoundedStringArray(raw.requiredCapabilities);
  const warnings = toBoundedStringArray(raw.warnings);

  // ═══════════════════════════════════════════════════════════════
  // SERVER-SIDE RISK CLASSIFICATION
  // CRITICAL: Our code makes the final risk decision — never the AI model!
  // ═══════════════════════════════════════════════════════════════
  const riskReasons: string[] = [];
  let overallRisk: OverallRiskLevel = "LOW";

  // Check required capabilities vs granted scopes
  const missingScopes: string[] = [];
  for (const cap of requiredCapabilities) {
    const isGranted = context.grantedScopes.some(
      (scope) => scope.toLowerCase() === cap.toLowerCase() || scope.toLowerCase().includes(cap.toLowerCase())
    );
    if (!isGranted) {
      missingScopes.push(cap);
    }
  }

  if (missingScopes.length > 0) {
    riskReasons.push(
      `Required Shopify scope(s) not currently granted: ${missingScopes.join(", ")}.`
    );
  }

  // ── BLOCKED: Multiple DELETE steps in a single plan ──
  if (hasMultipleDeleteSteps) {
    overallRisk = "BLOCKED";
    riskReasons.push(
      "BLOCKED: Plan contains multiple deletion operations. Batch deletions require individual step approval."
    );
  }
  // ── HIGH: Any DELETE or theme modification ──
  else if (hasDeleteIntent) {
    overallRisk = "HIGH";
    riskReasons.push("Plan contains resource deletion intent (DELETE). Deletion is high-risk.");
  } else if (hasThemeChange) {
    overallRisk = "HIGH";
    riskReasons.push("Plan involves modifications to storefront code or theme behavior.");
  }
  // ── MEDIUM: Write/modify intents ──
  else if (hasWriteOrModifyIntent) {
    overallRisk = "MEDIUM";
    riskReasons.push("Plan proposes creating or updating store configurations/metadata.");
  }
  // ── LOW: Read-only / analytical ──
  else {
    overallRisk = "LOW";
    riskReasons.push("Plan is strictly read-only / analytical.");
  }

  if (missingScopes.length > 0 && overallRisk === "LOW") {
    overallRisk = "MEDIUM";
  }

  // Merge with model risk reasons safely (model cannot lower our risk, only add info)
  if (raw.risk && typeof raw.risk === "object") {
    const rawRisk = raw.risk as Record<string, unknown>;
    const modelReasons = toBoundedStringArray(rawRisk.reasons, 10, 300);
    for (const r of modelReasons) {
      if (!riskReasons.includes(r)) {
        riskReasons.push(r);
      }
    }
  }

  // Plan approval is required if any write or destructive intent exists, or risk is not LOW
  const approvalRequired = hasWriteOrModifyIntent || overallRisk !== "LOW";

  // Server-authored metadata — planId, shop, createdAt are NEVER sourced from AI model
  const planId = crypto.randomUUID();

  const plan: AiDevelopmentPlan = {
    schemaVersion: 1,
    planId,
    shop: context.shop, // CRITICAL: strictly server-derived, never trusted from AI
    createdAt: new Date().toISOString(),
    userRequest: context.userRequest,
    summary,
    objective,
    providerExecution: {
      requestedMode: context.requestedMode,
      effectiveMode: context.effectiveMode,
      primaryProvider: context.primaryProvider,
      reviewerProvider: context.reviewerProvider || null,
      fallbackOccurred: context.fallbackOccurred,
      attempts: context.attempts,
    },
    contextReference: {
      snapshotId: context.contextSnapshotId,
      analyzedAt: context.contextAnalyzedAt,
    },
    knownFacts,
    assumptions,
    questions,
    impactAreas: impactAreas.length > 0 ? impactAreas : ["Storefront"],
    proposedSteps: normalizedSteps,
    requiredCapabilities,
    warnings,
    risk: {
      overall: overallRisk,
      reasons: riskReasons,
    },
    approval: {
      required: approvalRequired,
      status: overallRisk === "BLOCKED" ? "READY_FOR_REVIEW" : "READY_FOR_REVIEW",
    },
  };

  return { valid: true, plan };
}
