import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigate, useNavigation, useRouteError } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { getLatestStoreContextSnapshot } from "../core/context/context-cache.server";
import { executePlanning } from "../core/ai/provider-router.server";
import {
  approveAiPlan,
  getAiPlanById,
  rejectAiPlan,
} from "../core/ai/plan-persistence.server";
import type {
  AiDevelopmentPlan,
  PlanningMode,
  ProviderConnectionSummary,
  SupportedProviderId,
} from "../core/ai/types";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const planIdParam = url.searchParams.get("planId");

  const setting = await db.storeSetting.findUnique({
    where: { shop },
  });

  const credentials = await db.aiCredential.findMany({
    where: { shop, isValid: true },
    select: {
      provider: true,
      lastFour: true,
      lastValidatedAt: true,
    },
  });

  const providerNames: Record<string, string> = {
    gemini: "Google Gemini",
    openai: "OpenAI",
    anthropic: "Anthropic Claude",
    openrouter: "OpenRouter",
  };

  const connectedProviders: ProviderConnectionSummary[] = credentials.map((c) => ({
    id: c.provider as SupportedProviderId,
    name: providerNames[c.provider] || c.provider,
    description: "",
    isEnabled: true,
    isConnected: true,
    isActive: c.provider === setting?.activeProvider,
    lastFour: c.lastFour,
    lastValidatedAt: c.lastValidatedAt ? c.lastValidatedAt.toISOString() : null,
  }));

  const latestSnapshot = await getLatestStoreContextSnapshot(shop);

  let initialPlan: AiDevelopmentPlan | null = null;
  if (planIdParam) {
    const loadedPlan = await getAiPlanById(shop, planIdParam);
    if (loadedPlan) {
      initialPlan = loadedPlan.plan;
    }
  }

  return {
    shop,
    activeProvider: setting?.activeProvider || null,
    connectedProviders,
    latestSnapshot: latestSnapshot
      ? {
          id: latestSnapshot.id,
          analyzedAt: latestSnapshot.analyzedAt.toISOString(),
          productCount: latestSnapshot.summary.productSummary.totalCount,
          collectionCount: latestSnapshot.summary.collectionSummary.totalCount,
          metafieldCount: latestSnapshot.summary.metafieldDefinitions.length,
          metaobjectCount: latestSnapshot.summary.metaobjectDefinitions.length,
        }
      : null,
    initialPlan,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent") as string | null;

  if (intent === "generate_plan") {
    const prompt = (formData.get("prompt") as string | null)?.trim() || "";
    const mode = ((formData.get("mode") as string | null)?.trim() || "STANDARD") as PlanningMode;

    if (!prompt || prompt.length < 5) {
      return {
        success: false,
        error: "Please enter a specific development request (at least 5 characters).",
      };
    }

    const contextSnapshot = await getLatestStoreContextSnapshot(shop);
    if (!contextSnapshot) {
      return {
        success: false,
        missingContext: true,
        error: "Analyze Store Context before generating a store-aware development plan.",
      };
    }

    const executionResult = await executePlanning({
      shop,
      userRequest: prompt,
      mode,
      contextSnapshot,
    });

    if (!executionResult.success || !executionResult.plan) {
      return {
        success: false,
        missingContext: executionResult.missingContext,
        error:
          executionResult.errorMessage ||
          "Plan generation could not be completed. Please verify your AI connection.",
      };
    }

    return {
      success: true,
      plan: executionResult.plan,
      fallbackOccurred: executionResult.fallbackOccurred,
      message: "Development plan generated successfully.",
    };
  }

  if (intent === "approve_plan") {
    const planId = (formData.get("planId") as string | null)?.trim();
    if (!planId) {
      return { success: false, error: "Missing plan identifier for approval." };
    }

    try {
      const approved = await approveAiPlan(shop, planId);
      return {
        success: true,
        plan: approved.plan,
        message: "Plan approved. No Shopify changes have been executed yet.",
      };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to approve plan.",
      };
    }
  }

  if (intent === "reject_plan") {
    const planId = (formData.get("planId") as string | null)?.trim();
    if (!planId) {
      return { success: false, error: "Missing plan identifier for rejection." };
    }

    try {
      const rejected = await rejectAiPlan(shop, planId);
      return {
        success: true,
        plan: rejected.plan,
        message: "Plan has been rejected.",
      };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to reject plan.",
      };
    }
  }

  return { success: false, error: "Unsupported planning action intent." };
};

export default function AiDeveloper() {
  const {
    activeProvider,
    connectedProviders,
    latestSnapshot,
    initialPlan,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();

  const [promptInput, setPromptInput] = useState("");
  const [planningMode, setPlanningMode] = useState<PlanningMode>("STANDARD");

  const isSubmitting = navigation.state === "submitting" || navigation.state === "loading";
  const displayedPlan: AiDevelopmentPlan | null =
    (actionData?.success && actionData.plan) || initialPlan || null;

  const activeProviderObj = connectedProviders.find((p) => p.id === activeProvider);
  const hasAiConnected = connectedProviders.length > 0;
  const hasContext = Boolean(latestSnapshot);

  const examplePrompts = [
    "Build a made-to-measure product configurator with custom width and height inputs.",
    "Create metafields for material, finish, and care instructions across products.",
    "Audit my store catalog and metaobjects architecture before redesigning.",
    "Fix mobile layout issues on my product page and cart drawer.",
  ];

  return (
    <s-page heading="AI Developer">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate("/app/history")}
      >
        View Build History
      </s-button>

      {/* Action Messages & Alerts */}
      {actionData?.error && (
        <s-banner tone="critical">
          <s-paragraph>{actionData.error}</s-paragraph>
        </s-banner>
      )}

      {actionData?.success && actionData.message && (
        <s-banner tone="success">
          <s-paragraph>{actionData.message}</s-paragraph>
        </s-banner>
      )}

      {/* Readiness / Prerequisites Check */}
      <s-stack direction="block" gap="base">
        {!hasAiConnected && (
          <s-banner tone="warning">
            <s-paragraph>
              <strong>No AI Brain Connected:</strong> You must connect at least one AI provider (Google Gemini or OpenAI) before generating implementation plans.
            </s-paragraph>
            <s-button onClick={() => navigate("/app/connections")}>
              Connect AI Provider
            </s-button>
          </s-banner>
        )}

        {!hasContext && (
          <s-banner tone="warning">
            <s-paragraph>
              <strong>Store Context Missing:</strong> The AI engine requires an authoritative snapshot of your store&apos;s catalog, metafields, and granted scopes before generating plans.
            </s-paragraph>
            <s-button onClick={() => navigate("/app/context")}>
              Analyze Store Context
            </s-button>
          </s-banner>
        )}
      </s-stack>

      {/* System Status Ribbon */}
      <s-section heading="Engine Environment">
        <s-stack direction="inline" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="small">
              <s-heading>Active Brain</s-heading>
              <s-paragraph>
                {activeProviderObj
                  ? `${activeProviderObj.name} (Key ending in ${activeProviderObj.lastFour})`
                  : hasAiConnected
                  ? `${connectedProviders[0].name} (Standby)`
                  : "None connected"}
              </s-paragraph>
              <s-badge tone={hasAiConnected ? "success" : "caution"}>
                {hasAiConnected ? `${connectedProviders.length} Provider(s) Ready` : "Disconnected"}
              </s-badge>
            </s-stack>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="small">
              <s-heading>Store Context Snapshot</s-heading>
              <s-paragraph>
                {latestSnapshot
                  ? `${latestSnapshot.productCount} Products • ${latestSnapshot.collectionCount} Collections • ${latestSnapshot.metafieldCount} Metafields`
                  : "Not yet indexed"}
              </s-paragraph>
              <s-badge tone={latestSnapshot ? "success" : "caution"}>
                {latestSnapshot ? "Analyzed" : "Required"}
              </s-badge>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* Prompt Studio */}
      <s-section heading="Prompt Studio">
        <s-paragraph>
          Describe the Shopify functionality or modification you want to build. The AI planning engine will cross-reference your request with store architecture to generate a structured, step-by-step implementation plan.
        </s-paragraph>

        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <Form method="post">
            <input type="hidden" name="intent" value="generate_plan" />
            <input type="hidden" name="mode" value={planningMode} />

            <s-stack direction="block" gap="base">
              <s-stack direction="block" gap="small">
                <s-heading>Merchant Development Request</s-heading>
                <textarea
                  name="prompt"
                  rows={4}
                  value={promptInput}
                  onChange={(e) => setPromptInput(e.target.value)}
                  placeholder="e.g. Create a made-to-measure product configurator with dimension validations and line-item properties..."
                  style={{
                    width: "100%",
                    padding: "10px",
                    fontFamily: "inherit",
                    fontSize: "14px",
                    borderRadius: "6px",
                    border: "1px solid #dcdcdc",
                    boxSizing: "border-box",
                  }}
                  disabled={isSubmitting}
                  required
                />
              </s-stack>

              {/* Quick Example Chips */}
              <s-stack direction="block" gap="small">
                <s-paragraph>
                  <s-text><strong>Quick Examples:</strong></s-text>
                </s-paragraph>
                <s-stack direction="inline" gap="small">
                  {examplePrompts.map((ex, idx) => (
                    <s-button
                      key={idx}
                      onClick={() => setPromptInput(ex)}
                      disabled={isSubmitting}
                    >
                      {ex.slice(0, 36)}...
                    </s-button>
                  ))}
                </s-stack>
              </s-stack>

              {/* Planning Mode Selection */}
              <s-box padding="base" borderWidth="base" borderRadius="base" background="base">
                <s-stack direction="block" gap="small">
                  <s-heading>Planning Engine Mode</s-heading>
                  <s-stack direction="inline" gap="base">
                    <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="planning_mode_choice"
                        value="STANDARD"
                        checked={planningMode === "STANDARD"}
                        onChange={() => setPlanningMode("STANDARD")}
                        disabled={isSubmitting}
                      />
                      <span><strong>Standard Mode:</strong> Fast single-AI architecture plan.</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="planning_mode_choice"
                        value="REVIEWED"
                        checked={planningMode === "REVIEWED"}
                        onChange={() => setPlanningMode("REVIEWED")}
                        disabled={isSubmitting}
                      />
                      <span><strong>Reviewed Mode:</strong> Multi-AI peer review (audits primary plan with secondary connected AI).</span>
                    </label>
                  </s-stack>
                </s-stack>
              </s-box>

              {/* Submit Button */}
              <s-stack direction="inline" gap="base">
                <s-button
                  type="submit"
                  variant="primary"
                  disabled={isSubmitting || !hasAiConnected || !hasContext || promptInput.trim().length < 5}
                >
                  {isSubmitting ? "Generating development plan..." : "Generate Development Plan"}
                </s-button>
              </s-stack>
            </s-stack>
          </Form>
        </s-box>
      </s-section>

      {/* Generated Plan Review UI */}
      {displayedPlan && (
        <s-section heading="Technical Implementation Plan">
          {/* Prominent Execution Status Notice */}
          {displayedPlan.risk.overall === "BLOCKED" ? (
            <s-banner tone="critical">
              <s-paragraph>
                <strong>⛔ Plan Blocked:</strong>{" "}
                This plan has been automatically blocked by the safety engine due to high-risk patterns.
                Review the risk assessment below for details. The plan cannot be approved in its current form.
              </s-paragraph>
            </s-banner>
          ) : (
            <s-banner tone={displayedPlan.approval.status === "APPROVED" ? "success" : "info"}>
              <s-paragraph>
                <strong>Execution Notice:</strong>{" "}
                {displayedPlan.approval.status === "APPROVED"
                  ? "Plan approved. No Shopify changes have been executed yet."
                  : "No Shopify changes have been executed. Review the technical plan and approve or reject below."}
              </s-paragraph>
            </s-banner>
          )}

          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              {/* Header Info */}
              <s-stack direction="inline" gap="base">
                <s-stack direction="block" gap="none">
                  <s-heading>{displayedPlan.summary}</s-heading>
                  <s-paragraph><strong>Objective:</strong> {displayedPlan.objective}</s-paragraph>
                </s-stack>
                <s-badge
                  tone={
                    displayedPlan.risk.overall === "LOW"
                      ? "success"
                      : displayedPlan.risk.overall === "MEDIUM"
                      ? "caution"
                      : "critical"
                  }
                >
                  Risk: {displayedPlan.risk.overall}
                </s-badge>
              </s-stack>

              {/* Engine Execution Metadata */}
              <s-box padding="base" borderWidth="base" borderRadius="base" background="base">
                <s-paragraph>
                  <s-text><strong>Generated by: </strong></s-text>
                  <code>{displayedPlan.providerExecution.primaryProvider.toUpperCase()}</code>
                  {displayedPlan.providerExecution.reviewerProvider && (
                    <>
                      <s-text> • <strong>Reviewed by: </strong></s-text>
                      <code>{displayedPlan.providerExecution.reviewerProvider.toUpperCase()}</code>
                    </>
                  )}
                  {displayedPlan.providerExecution.fallbackOccurred && (
                    <s-text> • <strong>(Automatic Failover Engaged)</strong></s-text>
                  )}
                  <s-text> • <strong>Mode: </strong></s-text>
                  <code>{displayedPlan.providerExecution.effectiveMode}</code>
                  <s-text> • <strong>Created: </strong></s-text>
                  {new Date(displayedPlan.createdAt).toLocaleString()}
                </s-paragraph>
              </s-box>

              {/* Impact Areas */}
              <s-stack direction="inline" gap="small">
                <s-paragraph><s-text><strong>Impact Areas:</strong></s-text></s-paragraph>
                {displayedPlan.impactAreas.map((area, idx) => (
                  <s-badge key={idx} tone="info">{area}</s-badge>
                ))}
              </s-stack>

              {/* Known Facts & Assumptions */}
              <s-stack direction="inline" gap="base">
                <s-box padding="base" borderWidth="base" borderRadius="base" background="base">
                  <s-heading>Store Facts Verified</s-heading>
                  {displayedPlan.knownFacts.length > 0 ? (
                    <s-unordered-list>
                      {displayedPlan.knownFacts.map((fact, idx) => (
                        <s-list-item key={idx}>{fact}</s-list-item>
                      ))}
                    </s-unordered-list>
                  ) : (
                    <s-paragraph>None specified.</s-paragraph>
                  )}
                </s-box>

                <s-box padding="base" borderWidth="base" borderRadius="base" background="base">
                  <s-heading>Assumptions Made</s-heading>
                  {displayedPlan.assumptions.length > 0 ? (
                    <s-unordered-list>
                      {displayedPlan.assumptions.map((assump, idx) => (
                        <s-list-item key={idx}>{assump}</s-list-item>
                      ))}
                    </s-unordered-list>
                  ) : (
                    <s-paragraph>No unverified assumptions.</s-paragraph>
                  )}
                </s-box>
              </s-stack>

              {/* Questions / Missing Information */}
              {displayedPlan.questions.length > 0 && (
                <s-banner tone="warning">
                  <s-heading>Clarifications &amp; Questions Before Execution</s-heading>
                  <s-unordered-list>
                    {displayedPlan.questions.map((q, idx) => (
                      <s-list-item key={idx}>{q}</s-list-item>
                    ))}
                  </s-unordered-list>
                </s-banner>
              )}

              {/* Proposed Steps */}
              <s-heading>Proposed Implementation Steps ({displayedPlan.proposedSteps.length})</s-heading>
              <s-stack direction="block" gap="base">
                {displayedPlan.proposedSteps.map((step, idx) => (
                  <s-box key={step.id || idx} padding="base" borderWidth="base" borderRadius="base" background="base">
                    <s-stack direction="block" gap="small">
                      <s-stack direction="inline" gap="base">
                        <s-heading>
                          {idx + 1}. {step.title}
                        </s-heading>
                        <s-stack direction="inline" gap="small">
                          <s-badge tone="info">{step.category}</s-badge>
                          <s-badge tone={step.operationIntent === "DELETE" ? "critical" : "neutral"}>
                            {step.operationIntent}
                          </s-badge>
                          <s-badge
                            tone={
                              step.riskLevel === "LOW"
                                ? "success"
                                : step.riskLevel === "MEDIUM"
                                ? "caution"
                                : "critical"
                            }
                          >
                            {step.riskLevel} Risk
                          </s-badge>
                          <s-badge tone={step.reversible ? "success" : "caution"}>
                            {step.reversible ? "Reversible" : "Irreversible"}
                          </s-badge>
                        </s-stack>
                      </s-stack>

                      <s-paragraph>{step.description}</s-paragraph>

                      <s-paragraph>
                        <s-text><strong>Target: </strong></s-text><code>{step.target}</code>
                        {step.rationale && (
                          <> • <s-text><strong>Rationale: </strong></s-text>{step.rationale}</>
                        )}
                      </s-paragraph>

                      {step.expectedOutcome && (
                        <s-paragraph>
                          <s-text><strong>Expected Outcome: </strong></s-text>
                          <em>{step.expectedOutcome}</em>
                        </s-paragraph>
                      )}
                    </s-stack>
                  </s-box>
                ))}
              </s-stack>

              {/* Required Capabilities & Risk Factors */}
              <s-stack direction="inline" gap="base">
                <s-box padding="base" borderWidth="base" borderRadius="base" background="base">
                  <s-heading>Required Capabilities</s-heading>
                  {displayedPlan.requiredCapabilities.length > 0 ? (
                    <s-unordered-list>
                      {displayedPlan.requiredCapabilities.map((cap, idx) => (
                        <s-list-item key={idx}><code>{cap}</code></s-list-item>
                      ))}
                    </s-unordered-list>
                  ) : (
                    <s-paragraph>No special permissions required.</s-paragraph>
                  )}
                </s-box>

                <s-box padding="base" borderWidth="base" borderRadius="base" background="base">
                  <s-heading>Safety &amp; Risk Assessment</s-heading>
                  <s-paragraph>
                    <strong>Overall Risk: </strong>
                    <s-text>{displayedPlan.risk.overall}</s-text>
                  </s-paragraph>
                  {displayedPlan.risk.reasons.length > 0 && (
                    <s-unordered-list>
                      {displayedPlan.risk.reasons.map((reason, idx) => (
                        <s-list-item key={idx}>{reason}</s-list-item>
                      ))}
                    </s-unordered-list>
                  )}
                </s-box>
              </s-stack>

              {/* Plan Action Decision Area */}
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <s-stack direction="inline" gap="base">
                  {displayedPlan.approval.status === "READY_FOR_REVIEW" && displayedPlan.risk.overall !== "BLOCKED" && (
                    <>
                      <Form method="post">
                        <input type="hidden" name="intent" value="approve_plan" />
                        <input type="hidden" name="planId" value={displayedPlan.planId} />
                        <s-button type="submit" variant="primary" disabled={isSubmitting}>
                          Approve Plan
                        </s-button>
                      </Form>

                      <Form method="post">
                        <input type="hidden" name="intent" value="reject_plan" />
                        <input type="hidden" name="planId" value={displayedPlan.planId} />
                        <s-button type="submit" disabled={isSubmitting}>
                          Reject Plan
                        </s-button>
                      </Form>
                    </>
                  )}

                  {displayedPlan.approval.status === "READY_FOR_REVIEW" && displayedPlan.risk.overall === "BLOCKED" && (
                    <>
                      <s-badge tone="critical">Plan Status: Blocked by Safety Engine</s-badge>
                      <Form method="post">
                        <input type="hidden" name="intent" value="reject_plan" />
                        <input type="hidden" name="planId" value={displayedPlan.planId} />
                        <s-button type="submit" disabled={isSubmitting}>
                          Dismiss Blocked Plan
                        </s-button>
                      </Form>
                    </>
                  )}

                  {displayedPlan.approval.status === "APPROVED" && (
                    <s-badge tone="success">Plan Status: Approved</s-badge>
                  )}

                  {displayedPlan.approval.status === "REJECTED" && (
                    <s-badge tone="critical">Plan Status: Rejected</s-badge>
                  )}

                  <s-button onClick={() => navigate("/app/history")}>
                    View All Plans in History
                  </s-button>
                </s-stack>
              </s-box>
            </s-stack>
          </s-box>
        </s-section>
      )}

      {/* Safety Workflow Aside */}
      <s-section slot="aside" heading="Safety Workflow">
        <s-ordered-list>
          <s-list-item>Natural language request</s-list-item>
          <s-list-item>Store context projection</s-list-item>
          <s-list-item>Structured plan generation</s-list-item>
          <s-list-item>Server-side risk classification</s-list-item>
          <s-list-item>Merchant review &amp; approval</s-list-item>
          <s-list-item>Zero mutations until future execution milestone</s-list-item>
        </s-ordered-list>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  return boundary.error(error);
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
