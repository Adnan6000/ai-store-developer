import { useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigate,
  useNavigation,
  useRouteError,
} from "react-router";
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

import "../styles/developer.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const planIdParam = url.searchParams.get("planId");

  const setting = await db.storeSetting.findUnique({
    where: { shop },
  });

  const credentials = await db.aiCredential.findMany({
    where: {
      shop,
      isValid: true,
    },
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

  const connectedProviders: ProviderConnectionSummary[] = credentials.map(
    (credential) => ({
      id: credential.provider as SupportedProviderId,
      name: providerNames[credential.provider] || credential.provider,
      description: "",
      isEnabled: true,
      isConnected: true,
      isActive: credential.provider === setting?.activeProvider,
      lastFour: credential.lastFour,
      lastValidatedAt: credential.lastValidatedAt
        ? credential.lastValidatedAt.toISOString()
        : null,
    }),
  );

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
          metafieldCount:
            latestSnapshot.summary.metafieldDefinitions.length,
          metaobjectCount:
            latestSnapshot.summary.metaobjectDefinitions.length,
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
    const prompt =
      (formData.get("prompt") as string | null)?.trim() || "";

    const mode = (
      (formData.get("mode") as string | null)?.trim() || "STANDARD"
    ) as PlanningMode;

    if (!prompt || prompt.length < 5) {
      return {
        success: false,
        error:
          "Please enter a specific development request (at least 5 characters).",
      };
    }

    const contextSnapshot =
      await getLatestStoreContextSnapshot(shop);

    if (!contextSnapshot) {
      return {
        success: false,
        missingContext: true,
        error:
          "Analyze Store Context before generating a store-aware development plan.",
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
    const planId =
      (formData.get("planId") as string | null)?.trim();

    if (!planId) {
      return {
        success: false,
        error: "Missing plan identifier for approval.",
      };
    }

    try {
      const approved = await approveAiPlan(shop, planId);

      return {
        success: true,
        plan: approved.plan,
        message:
          "Plan approved. No Shopify changes have been executed yet.",
      };
    } catch (err: unknown) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : "Failed to approve plan.",
      };
    }
  }

  if (intent === "reject_plan") {
    const planId =
      (formData.get("planId") as string | null)?.trim();

    if (!planId) {
      return {
        success: false,
        error: "Missing plan identifier for rejection.",
      };
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
        error:
          err instanceof Error
            ? err.message
            : "Failed to reject plan.",
      };
    }
  }

  return {
    success: false,
    error: "Unsupported planning action intent.",
  };
};

type PlanTab =
  | "overview"
  | "steps"
  | "facts"
  | "assumptions"
  | "questions"
  | "risk";

function getRiskClass(risk: string) {
  if (risk === "LOW") return "asd-risk-low";
  if (risk === "MEDIUM") return "asd-risk-medium";
  if (risk === "HIGH") return "asd-risk-high";
  return "asd-risk-blocked";
}

function formatProvider(provider: string | null | undefined) {
  if (!provider) return "Unknown";

  if (provider === "openrouter") return "OpenRouter";
  if (provider === "openai") return "OpenAI";
  if (provider === "gemini") return "Gemini";
  if (provider === "anthropic") return "Anthropic";

  return provider;
}

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
  const [planningMode, setPlanningMode] =
    useState<PlanningMode>("STANDARD");
  const [activeTab, setActiveTab] =
    useState<PlanTab>("overview");

  const isSubmitting =
    navigation.state === "submitting" ||
    navigation.state === "loading";

  const displayedPlan: AiDevelopmentPlan | null =
    (actionData?.success && actionData.plan) ||
    initialPlan ||
    null;

  const activeProviderObj = connectedProviders.find(
    (provider) => provider.id === activeProvider,
  );

  const hasAiConnected = connectedProviders.length > 0;
  const hasContext = Boolean(latestSnapshot);

  const examplePrompts = [
    "Build a made-to-measure product configurator with custom width and height inputs.",
    "Create metafields for material, finish, and care instructions across products.",
    "Audit my store catalog and metaobjects architecture before redesigning.",
    "Fix mobile layout issues on my product page and cart drawer.",
  ];

  const planStats = useMemo(() => {
    if (!displayedPlan) return null;

    return {
      steps: displayedPlan.proposedSteps.length,
      capabilities: displayedPlan.requiredCapabilities.length,
      questions: displayedPlan.questions.length,
      impactAreas: displayedPlan.impactAreas.length,
    };
  }, [displayedPlan]);

  return (
    <s-page heading="AI Developer">
      <s-button
        slot="primary-action"
        onClick={() => navigate("/app/history")}
      >
        Build History
      </s-button>

      <div className="asd-page">
        {actionData?.error && (
          <div className="asd-alert asd-alert-error">
            <div className="asd-alert-icon">!</div>
            <div>
              <strong>Unable to complete request</strong>
              <p>{actionData.error}</p>
            </div>
          </div>
        )}

        {actionData?.success && actionData.message && (
          <div className="asd-alert asd-alert-success">
            <div className="asd-alert-icon">✓</div>
            <div>
              <strong>{actionData.message}</strong>
              <p>
                Shopify store data has not been changed by the
                planning operation.
              </p>
            </div>
          </div>
        )}

        {!hasAiConnected && (
          <div className="asd-alert asd-alert-warning">
            <div className="asd-alert-icon">!</div>
            <div>
              <strong>No AI provider connected</strong>
              <p>
                Connect an AI provider before creating development
                plans.
              </p>
              <button
                className="asd-text-button"
                onClick={() => navigate("/app/connections")}
              >
                Open AI Connections
              </button>
            </div>
          </div>
        )}

        {!hasContext && (
          <div className="asd-alert asd-alert-warning">
            <div className="asd-alert-icon">!</div>
            <div>
              <strong>Store context required</strong>
              <p>
                Analyze your Shopify store before generating a
                store-aware plan.
              </p>
              <button
                className="asd-text-button"
                onClick={() => navigate("/app/context")}
              >
                Analyze Store Context
              </button>
            </div>
          </div>
        )}

        <section className="asd-statusbar">
          <div className="asd-status-item">
            <span className="asd-status-icon asd-status-icon-ai">
              AI
            </span>

            <div>
              <span className="asd-eyebrow">
                Active Brain
              </span>
              <strong>
                {activeProviderObj
                  ? activeProviderObj.name
                  : hasAiConnected
                    ? connectedProviders[0].name
                    : "Not connected"}
              </strong>

              {activeProviderObj?.lastFour && (
                <span className="asd-muted">
                  Key •••• {activeProviderObj.lastFour}
                </span>
              )}
            </div>
          </div>

          <div className="asd-status-divider" />

          <div className="asd-status-item">
            <span className="asd-status-icon">◎</span>

            <div>
              <span className="asd-eyebrow">
                Store Context
              </span>
              <strong>
                {latestSnapshot
                  ? `${latestSnapshot.productCount} products`
                  : "Not analyzed"}
              </strong>

              {latestSnapshot && (
                <span className="asd-muted">
                  {latestSnapshot.collectionCount} collections ·{" "}
                  {latestSnapshot.metafieldCount} metafields
                </span>
              )}
            </div>
          </div>

          <div className="asd-status-divider" />

          <div className="asd-status-item">
            <span className="asd-status-icon">◈</span>

            <div>
              <span className="asd-eyebrow">
                Planning Mode
              </span>
              <strong>
                {planningMode === "STANDARD"
                  ? "Standard"
                  : "Reviewed"}
              </strong>
              <span className="asd-muted">
                {planningMode === "STANDARD"
                  ? "Single planner"
                  : "Multi-AI review"}
              </span>
            </div>
          </div>

          <div className="asd-status-divider" />

          <div className="asd-status-item">
            <span className="asd-status-icon asd-status-icon-safe">
              ✓
            </span>

            <div>
              <span className="asd-eyebrow">
                Safety Barrier
              </span>
              <strong>Protected</strong>
              <span className="asd-muted">
                Approval required
              </span>
            </div>
          </div>
        </section>

        <div className="asd-workspace">
          <main className="asd-main">
            <section className="asd-card asd-composer">
              <div className="asd-section-header">
                <div>
                  <span className="asd-eyebrow">
                    Development Request
                  </span>
                  <h2>What do you want to build?</h2>
                  <p>
                    Describe a feature, fix, architecture change or
                    Shopify customization.
                  </p>
                </div>

                <span className="asd-ready-pill">
                  <span className="asd-ready-dot" />
                  Planner ready
                </span>
              </div>

              <Form method="post">
                <input
                  type="hidden"
                  name="intent"
                  value="generate_plan"
                />
                <input
                  type="hidden"
                  name="mode"
                  value={planningMode}
                />

                <textarea
                  className="asd-prompt"
                  name="prompt"
                  rows={6}
                  value={promptInput}
                  onChange={(event) =>
                    setPromptInput(event.target.value)
                  }
                  placeholder="Describe the Shopify change you want the AI Developer to plan..."
                  disabled={isSubmitting}
                  required
                />

                <div className="asd-example-row">
                  <span>Examples</span>

                  <div className="asd-example-list">
                    {examplePrompts.map((example, index) => (
                      <button
                        type="button"
                        className="asd-example"
                        key={index}
                        disabled={isSubmitting}
                        onClick={() =>
                          setPromptInput(example)
                        }
                      >
                        {example.length > 44
                          ? `${example.slice(0, 44)}…`
                          : example}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="asd-composer-footer">
                  <div className="asd-mode-control">
                    <button
                      type="button"
                      className={
                        planningMode === "STANDARD"
                          ? "asd-mode-button active"
                          : "asd-mode-button"
                      }
                      onClick={() =>
                        setPlanningMode("STANDARD")
                      }
                      disabled={isSubmitting}
                    >
                      <span className="asd-mode-title">
                        Standard
                      </span>
                      <span>Fast planning</span>
                    </button>

                    <button
                      type="button"
                      className={
                        planningMode === "REVIEWED"
                          ? "asd-mode-button active"
                          : "asd-mode-button"
                      }
                      onClick={() =>
                        setPlanningMode("REVIEWED")
                      }
                      disabled={isSubmitting}
                    >
                      <span className="asd-mode-title">
                        Reviewed
                      </span>
                      <span>Peer reviewed</span>
                    </button>
                  </div>

                  <button
                    type="submit"
                    className="asd-primary-button"
                    disabled={
                      isSubmitting ||
                      !hasAiConnected ||
                      !hasContext ||
                      promptInput.trim().length < 5
                    }
                  >
                    {isSubmitting ? (
                      <>
                        <span className="asd-spinner" />
                        Generating plan
                      </>
                    ) : (
                      <>
                        Generate Plan
                        <span>→</span>
                      </>
                    )}
                  </button>
                </div>
              </Form>
            </section>

            {displayedPlan && (
              <section className="asd-card asd-plan-card">
                <div className="asd-plan-header">
                  <div className="asd-plan-title">
                    <span className="asd-eyebrow">
                      Technical Implementation Plan
                    </span>

                    <h2>{displayedPlan.summary}</h2>

                    <p>{displayedPlan.objective}</p>
                  </div>

                  <span
                    className={`asd-risk-pill ${getRiskClass(
                      displayedPlan.risk.overall,
                    )}`}
                  >
                    {displayedPlan.risk.overall} RISK
                  </span>
                </div>

                <div className="asd-plan-meta">
                  <span>
                    <strong>
                      {formatProvider(
                        displayedPlan.providerExecution
                          .primaryProvider,
                      )}
                    </strong>
                  </span>

                  <span className="asd-meta-dot">•</span>

                  <span>
                    {
                      displayedPlan.providerExecution
                        .effectiveMode
                    }
                  </span>

                  <span className="asd-meta-dot">•</span>

                  <span>
                    {new Date(
                      displayedPlan.createdAt,
                    ).toLocaleString()}
                  </span>

                  {displayedPlan.providerExecution
                    .reviewerProvider && (
                    <>
                      <span className="asd-meta-dot">
                        •
                      </span>
                      <span>
                        Reviewed by{" "}
                        {formatProvider(
                          displayedPlan.providerExecution
                            .reviewerProvider,
                        )}
                      </span>
                    </>
                  )}

                  {displayedPlan.providerExecution
                    .fallbackOccurred && (
                    <>
                      <span className="asd-meta-dot">
                        •
                      </span>
                      <span className="asd-failover">
                        Failover used
                      </span>
                    </>
                  )}
                </div>

                <div className="asd-impact-row">
                  {displayedPlan.impactAreas.map(
                    (area, index) => (
                      <span
                        className="asd-chip"
                        key={`${area}-${index}`}
                      >
                        {area}
                      </span>
                    ),
                  )}
                </div>

                <nav className="asd-tabs">
                  {(
                    [
                      ["overview", "Overview"],
                      [
                        "steps",
                        `Steps (${displayedPlan.proposedSteps.length})`,
                      ],
                      [
                        "facts",
                        `Store Facts (${displayedPlan.knownFacts.length})`,
                      ],
                      [
                        "assumptions",
                        `Assumptions (${displayedPlan.assumptions.length})`,
                      ],
                      [
                        "questions",
                        `Questions (${displayedPlan.questions.length})`,
                      ],
                      ["risk", "Risk"],
                    ] as [PlanTab, string][]
                  ).map(([tab, label]) => (
                    <button
                      type="button"
                      key={tab}
                      className={
                        activeTab === tab
                          ? "asd-tab active"
                          : "asd-tab"
                      }
                      onClick={() =>
                        setActiveTab(tab)
                      }
                    >
                      {label}
                    </button>
                  ))}
                </nav>

                <div className="asd-tab-content">
                  {activeTab === "overview" && (
                    <div className="asd-overview-grid">
                      <div className="asd-overview-card">
                        <span className="asd-overview-number">
                          {planStats?.steps || 0}
                        </span>
                        <span>Implementation steps</span>
                      </div>

                      <div className="asd-overview-card">
                        <span className="asd-overview-number">
                          {planStats?.impactAreas || 0}
                        </span>
                        <span>Impact areas</span>
                      </div>

                      <div className="asd-overview-card">
                        <span className="asd-overview-number">
                          {planStats?.capabilities || 0}
                        </span>
                        <span>Required capabilities</span>
                      </div>

                      <div className="asd-overview-card">
                        <span className="asd-overview-number">
                          {planStats?.questions || 0}
                        </span>
                        <span>Open questions</span>
                      </div>

                      <div className="asd-summary-panel">
                        <div className="asd-summary-icon">
                          ✓
                        </div>

                        <div>
                          <h3>Planning completed safely</h3>
                          <p>
                            This operation generated an
                            implementation plan only. No Shopify
                            mutations have been performed.
                          </p>
                        </div>
                      </div>

                      {displayedPlan.questions.length > 0 && (
                        <div className="asd-warning-panel">
                          <div className="asd-warning-icon">
                            ?
                          </div>

                          <div>
                            <h3>
                              Clarification recommended
                            </h3>
                            <p>
                              {
                                displayedPlan.questions[0]
                              }
                            </p>

                            {displayedPlan.questions
                              .length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setActiveTab(
                                    "questions",
                                  )
                                }
                              >
                                View all{" "}
                                {
                                  displayedPlan.questions
                                    .length
                                }{" "}
                                questions
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {activeTab === "steps" && (
                    <div className="asd-step-list">
                      {displayedPlan.proposedSteps.map(
                        (step, index) => (
                          <article
                            className="asd-step"
                            key={step.id || index}
                          >
                            <div className="asd-step-index">
                              {index + 1}
                            </div>

                            <div className="asd-step-body">
                              <div className="asd-step-top">
                                <div>
                                  <h3>
                                    {step.title}
                                  </h3>

                                  <div className="asd-step-badges">
                                    <span className="asd-chip asd-chip-technical">
                                      {
                                        step.category
                                      }
                                    </span>

                                    <span className="asd-chip">
                                      {step.operationIntent}
                                    </span>

                                    <span
                                      className={`asd-risk-mini ${getRiskClass(
                                        step.riskLevel,
                                      )}`}
                                    >
                                      {
                                        step.riskLevel
                                      }{" "}
                                      RISK
                                    </span>

                                    <span
                                      className={
                                        step.reversible
                                          ? "asd-reversible"
                                          : "asd-irreversible"
                                      }
                                    >
                                      {step.reversible
                                        ? "Reversible"
                                        : "Irreversible"}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <p className="asd-step-description">
                                {step.description}
                              </p>

                              <div className="asd-step-detail-grid">
                                <div>
                                  <span className="asd-detail-label">
                                    Target
                                  </span>
                                  <p>
                                    {step.target}
                                  </p>
                                </div>

                                {step.rationale && (
                                  <div>
                                    <span className="asd-detail-label">
                                      Rationale
                                    </span>
                                    <p>
                                      {
                                        step.rationale
                                      }
                                    </p>
                                  </div>
                                )}
                              </div>

                              {step.expectedOutcome && (
                                <div className="asd-outcome">
                                  <span>
                                    Expected outcome
                                  </span>
                                  <p>
                                    {
                                      step.expectedOutcome
                                    }
                                  </p>
                                </div>
                              )}
                            </div>
                          </article>
                        ),
                      )}
                    </div>
                  )}

                  {activeTab === "facts" && (
                    <div className="asd-list-panel">
                      <div className="asd-list-panel-header">
                        <div className="asd-list-icon">
                          ✓
                        </div>
                        <div>
                          <h3>
                            Verified Store Facts
                          </h3>
                          <p>
                            Facts derived from the latest
                            Shopify store context snapshot.
                          </p>
                        </div>
                      </div>

                      {displayedPlan.knownFacts.length >
                      0 ? (
                        <ul className="asd-clean-list">
                          {displayedPlan.knownFacts.map(
                            (fact, index) => (
                              <li key={index}>
                                {fact}
                              </li>
                            ),
                          )}
                        </ul>
                      ) : (
                        <p className="asd-muted">
                          No verified facts recorded.
                        </p>
                      )}
                    </div>
                  )}

                  {activeTab === "assumptions" && (
                    <div className="asd-list-panel">
                      <div className="asd-list-panel-header">
                        <div className="asd-list-icon asd-list-icon-neutral">
                          i
                        </div>
                        <div>
                          <h3>Planning Assumptions</h3>
                          <p>
                            These items were inferred rather
                            than verified directly.
                          </p>
                        </div>
                      </div>

                      {displayedPlan.assumptions.length >
                      0 ? (
                        <ul className="asd-clean-list">
                          {displayedPlan.assumptions.map(
                            (assumption, index) => (
                              <li key={index}>
                                {assumption}
                              </li>
                            ),
                          )}
                        </ul>
                      ) : (
                        <p className="asd-muted">
                          No assumptions recorded.
                        </p>
                      )}
                    </div>
                  )}

                  {activeTab === "questions" && (
                    <div className="asd-list-panel">
                      <div className="asd-list-panel-header">
                        <div className="asd-list-icon asd-list-icon-warning">
                          ?
                        </div>
                        <div>
                          <h3>
                            Questions Before Execution
                          </h3>
                          <p>
                            These points may need merchant
                            clarification before applying
                            changes.
                          </p>
                        </div>
                      </div>

                      {displayedPlan.questions.length >
                      0 ? (
                        <ol className="asd-question-list">
                          {displayedPlan.questions.map(
                            (question, index) => (
                              <li key={index}>
                                <span>
                                  {index + 1}
                                </span>
                                <p>{question}</p>
                              </li>
                            ),
                          )}
                        </ol>
                      ) : (
                        <div className="asd-empty-state">
                          <span>✓</span>
                          <p>
                            No clarification is currently
                            required.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {activeTab === "risk" && (
                    <div className="asd-risk-grid">
                      <div className="asd-risk-score">
                        <span>Overall risk</span>

                        <strong
                          className={getRiskClass(
                            displayedPlan.risk.overall,
                          )}
                        >
                          {
                            displayedPlan.risk
                              .overall
                          }
                        </strong>

                        <p>
                          Server-side safety classification.
                        </p>
                      </div>

                      <div className="asd-list-panel">
                        <h3>Risk Assessment</h3>

                        {displayedPlan.risk.reasons
                          .length > 0 ? (
                          <ul className="asd-clean-list">
                            {displayedPlan.risk.reasons.map(
                              (reason, index) => (
                                <li key={index}>
                                  {reason}
                                </li>
                              ),
                            )}
                          </ul>
                        ) : (
                          <p className="asd-muted">
                            No additional risk factors
                            recorded.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}
          </main>

          <aside className="asd-sidebar">
            <div className="asd-sidebar-sticky">
              <section className="asd-card asd-inspector">
                <div className="asd-inspector-heading">
                  <div>
                    <span className="asd-eyebrow">
                      Plan Inspector
                    </span>
                    <h3>
                      {displayedPlan
                        ? "Plan ready"
                        : "Waiting for plan"}
                    </h3>
                  </div>

                  <span
                    className={
                      displayedPlan
                        ? "asd-state-dot ready"
                        : "asd-state-dot"
                    }
                  />
                </div>

                {displayedPlan ? (
                  <>
                    <div className="asd-inspector-grid">
                      <div>
                        <span>Risk</span>
                        <strong
                          className={getRiskClass(
                            displayedPlan.risk.overall,
                          )}
                        >
                          {
                            displayedPlan.risk
                              .overall
                          }
                        </strong>
                      </div>

                      <div>
                        <span>Steps</span>
                        <strong>
                          {
                            displayedPlan
                              .proposedSteps.length
                          }
                        </strong>
                      </div>

                      <div>
                        <span>Provider</span>
                        <strong>
                          {formatProvider(
                            displayedPlan
                              .providerExecution
                              .primaryProvider,
                          )}
                        </strong>
                      </div>

                      <div>
                        <span>Mode</span>
                        <strong>
                          {
                            displayedPlan
                              .providerExecution
                              .effectiveMode
                          }
                        </strong>
                      </div>
                    </div>

                    <div className="asd-inspector-section">
                      <span className="asd-inspector-label">
                        Required Capabilities
                      </span>

                      {displayedPlan
                        .requiredCapabilities.length >
                      0 ? (
                        <div className="asd-capability-list">
                          {displayedPlan.requiredCapabilities.map(
                            (capability, index) => (
                              <code key={index}>
                                {capability}
                              </code>
                            ),
                          )}
                        </div>
                      ) : (
                        <p className="asd-muted">
                          None required
                        </p>
                      )}
                    </div>

                    <div className="asd-inspector-section">
                      <span className="asd-inspector-label">
                        Safety State
                      </span>

                      <div className="asd-safety-state">
                        <span>✓</span>
                        <div>
                          <strong>
                            No execution yet
                          </strong>
                          <p>
                            Planning operation only
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="asd-inspector-actions">
                      {displayedPlan.approval.status ===
                        "READY_FOR_REVIEW" &&
                        displayedPlan.risk.overall !==
                          "BLOCKED" && (
                          <>
                            <Form method="post">
                              <input
                                type="hidden"
                                name="intent"
                                value="approve_plan"
                              />
                              <input
                                type="hidden"
                                name="planId"
                                value={
                                  displayedPlan.planId
                                }
                              />

                              <button
                                type="submit"
                                className="asd-primary-button asd-full-button"
                                disabled={
                                  isSubmitting
                                }
                              >
                                Approve Plan
                              </button>
                            </Form>

                            <Form method="post">
                              <input
                                type="hidden"
                                name="intent"
                                value="reject_plan"
                              />
                              <input
                                type="hidden"
                                name="planId"
                                value={
                                  displayedPlan.planId
                                }
                              />

                              <button
                                type="submit"
                                className="asd-secondary-button asd-full-button"
                                disabled={
                                  isSubmitting
                                }
                              >
                                Reject Plan
                              </button>
                            </Form>
                          </>
                        )}

                      {displayedPlan.approval.status ===
                        "APPROVED" && (
                        <div className="asd-approval-state approved">
                          <span>✓</span>
                          <div>
                            <strong>
                              Plan approved
                            </strong>
                            <p>
                              Awaiting execution
                              milestone.
                            </p>
                          </div>
                        </div>
                      )}

                      {displayedPlan.approval.status ===
                        "REJECTED" && (
                        <div className="asd-approval-state rejected">
                          <span>×</span>
                          <div>
                            <strong>
                              Plan rejected
                            </strong>
                            <p>
                              No changes were
                              executed.
                            </p>
                          </div>
                        </div>
                      )}

                      {displayedPlan.risk.overall ===
                        "BLOCKED" &&
                        displayedPlan.approval.status ===
                          "READY_FOR_REVIEW" && (
                          <>
                            <div className="asd-approval-state rejected">
                              <span>!</span>
                              <div>
                                <strong>
                                  Plan blocked
                                </strong>
                                <p>
                                  Safety engine
                                  prevents approval.
                                </p>
                              </div>
                            </div>

                            <Form method="post">
                              <input
                                type="hidden"
                                name="intent"
                                value="reject_plan"
                              />
                              <input
                                type="hidden"
                                name="planId"
                                value={
                                  displayedPlan.planId
                                }
                              />

                              <button
                                type="submit"
                                className="asd-secondary-button asd-full-button"
                                disabled={
                                  isSubmitting
                                }
                              >
                                Dismiss Plan
                              </button>
                            </Form>
                          </>
                        )}
                    </div>
                  </>
                ) : (
                  <div className="asd-inspector-empty">
                    <span>◇</span>
                    <p>
                      Generate a development plan to inspect
                      risk, permissions and execution steps
                      here.
                    </p>
                  </div>
                )}
              </section>

              <section className="asd-card asd-context-card">
                <div className="asd-context-heading">
                  <div>
                    <span className="asd-eyebrow">
                      Store Context
                    </span>
                    <h3>
                      {latestSnapshot
                        ? "Snapshot ready"
                        : "Context missing"}
                    </h3>
                  </div>

                  {latestSnapshot && (
                    <span className="asd-mini-success">
                      Analyzed
                    </span>
                  )}
                </div>

                {latestSnapshot ? (
                  <div className="asd-context-stats">
                    <div>
                      <strong>
                        {latestSnapshot.productCount}
                      </strong>
                      <span>Products</span>
                    </div>

                    <div>
                      <strong>
                        {latestSnapshot.collectionCount}
                      </strong>
                      <span>Collections</span>
                    </div>

                    <div>
                      <strong>
                        {latestSnapshot.metafieldCount}
                      </strong>
                      <span>Metafields</span>
                    </div>

                    <div>
                      <strong>
                        {latestSnapshot.metaobjectCount}
                      </strong>
                      <span>Metaobjects</span>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="asd-secondary-button asd-full-button"
                    onClick={() =>
                      navigate("/app/context")
                    }
                  >
                    Analyze Store
                  </button>
                )}
              </section>

              <section className="asd-card asd-safety-card">
                <div className="asd-safety-heading">
                  <span className="asd-shield">✓</span>

                  <div>
                    <span className="asd-eyebrow">
                      Safety Workflow
                    </span>
                    <h3>Merchant controlled</h3>
                  </div>
                </div>

                <div className="asd-safety-list">
                  <div>
                    <span>1</span>
                    <p>AI proposes implementation</p>
                  </div>

                  <div>
                    <span>2</span>
                    <p>Server validates risk</p>
                  </div>

                  <div>
                    <span>3</span>
                    <p>Merchant reviews plan</p>
                  </div>

                  <div>
                    <span>4</span>
                    <p>Approval required</p>
                  </div>

                  <div>
                    <span>5</span>
                    <p>Execution remains disabled</p>
                  </div>
                </div>
              </section>
            </div>
          </aside>
        </div>
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  return boundary.error(error);
}

export const headers: HeadersFunction = (
  headersArgs,
) => {
  return boundary.headers(headersArgs);
};