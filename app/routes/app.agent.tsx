import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useLoaderData,
  useNavigate,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getRecentAiPlans } from "../core/ai/plan-persistence.server";
import { getLatestStoreContextSnapshot } from "../core/context/context-cache.server";

import "../styles/agent.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const setting = await db.storeSetting.findUnique({
    where: { shop },
  });

  const recentPlans = await getRecentAiPlans(shop, 1);
  const latestPlanRecord = recentPlans[0] || null;

  const contextSnapshot =
    await getLatestStoreContextSnapshot(shop);

  return {
    shop,
    activeProvider: setting?.activeProvider || null,
    activeModel: setting?.activeModel || null,
    latestPlan: latestPlanRecord
      ? {
          id: latestPlanRecord.id,
          status: latestPlanRecord.status,
          riskLevel: latestPlanRecord.riskLevel,
          createdAt:
            latestPlanRecord.createdAt.toISOString(),
          userRequest: latestPlanRecord.userRequest,
          plan: latestPlanRecord.plan,
        }
      : null,
    context: contextSnapshot
      ? {
          analyzedAt:
            contextSnapshot.analyzedAt.toISOString(),
          products:
            contextSnapshot.summary.productSummary
              .totalCount,
          collections:
            contextSnapshot.summary.collectionSummary
              .totalCount,
          metafields:
            contextSnapshot.summary.metafieldDefinitions
              .length,
          metaobjects:
            contextSnapshot.summary.metaobjectDefinitions
              .length,
        }
      : null,
  };
};

function formatProvider(
  provider: string | null | undefined,
) {
  if (!provider) return "Not selected";

  if (provider === "openrouter") return "OpenRouter";
  if (provider === "openai") return "OpenAI";
  if (provider === "gemini") return "Gemini";
  if (provider === "anthropic") return "Anthropic";

  return provider;
}

function getRiskClass(risk: string) {
  if (risk === "LOW") return "agent-risk-low";
  if (risk === "MEDIUM") return "agent-risk-medium";
  if (risk === "HIGH") return "agent-risk-high";
  return "agent-risk-blocked";
}

export default function AgentWorkspace() {
  const {
    shop,
    activeProvider,
    activeModel,
    latestPlan,
    context,
  } = useLoaderData<typeof loader>();

  const navigate = useNavigate();

  const activities = latestPlan
    ? [
        {
          title: "Store context loaded",
          detail: context
            ? `${context.products} products, ${context.collections} collections and ${context.metafields} metafields available`
            : "Store context snapshot unavailable",
          state: "done",
        },
        {
          title: "Merchant request analyzed",
          detail: latestPlan.userRequest,
          state: "done",
        },
        {
          title: "Technical plan generated",
          detail: `${latestPlan.plan.proposedSteps.length} implementation steps prepared`,
          state: "done",
        },
        {
          title: "Risk classification completed",
          detail: `Overall plan risk: ${latestPlan.plan.risk.overall}`,
          state: "done",
        },
        {
          title:
            latestPlan.status === "APPROVED"
              ? "Merchant approval received"
              : latestPlan.status === "REJECTED"
                ? "Plan rejected by merchant"
                : "Waiting for merchant approval",
          detail:
            latestPlan.status === "APPROVED"
              ? "Plan is approved, but Shopify execution is not enabled yet."
              : latestPlan.status === "REJECTED"
                ? "No Shopify changes will be applied."
                : "No store mutation can happen before merchant approval.",
          state:
            latestPlan.status === "APPROVED" ||
            latestPlan.status === "REJECTED"
              ? "done"
              : "waiting",
        },
        {
          title: "Execution engine",
          detail:
            "Milestone 5 will apply validated Shopify changes here after approval.",
          state: "locked",
        },
        {
          title: "Post-change verification",
          detail:
            "The agent will verify the store after execution and record rollback data.",
          state: "locked",
        },
      ]
    : [];

  return (
    <s-page heading="Agent Workspace">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate("/app/developer")}
      >
        New Development Request
      </s-button>

      <div className="agent-page">
        <div className="agent-topbar">
          <div className="agent-store">
            <span className="agent-eyebrow">
              Connected Store
            </span>
            <strong>{shop}</strong>
          </div>

          <div className="agent-topstat">
            <span>AI Brain</span>
            <strong>
              {formatProvider(activeProvider)}
            </strong>
          </div>

          <div className="agent-topstat">
            <span>Model</span>
            <strong>
              {activeModel || "Auto selected"}
            </strong>
          </div>

          <div className="agent-topstat">
            <span>Safety</span>
            <strong className="agent-safe">
              Protected
            </strong>
          </div>

          <div className="agent-topstat">
            <span>Execution</span>
            <strong className="agent-locked">
              Locked
            </strong>
          </div>
        </div>

        {!latestPlan ? (
          <div className="agent-empty">
            <div className="agent-empty-icon">
              AI
            </div>

            <h2>No active development task</h2>

            <p>
              Create a development request first. The
              Agent Workspace will then show planning,
              files, risk, preview and execution activity
              here.
            </p>

            <button
              className="agent-primary-button"
              onClick={() =>
                navigate("/app/developer")
              }
            >
              Create Development Request
            </button>
          </div>
        ) : (
          <div className="agent-layout">
            <aside className="agent-activity-panel">
              <div className="agent-panel-heading">
                <div>
                  <span className="agent-eyebrow">
                    Agent Activity
                  </span>
                  <h2>Live task timeline</h2>
                </div>

                <span className="agent-live-pill">
                  <span />
                  Active
                </span>
              </div>

              <div className="agent-request">
                <span>Current request</span>
                <p>{latestPlan.userRequest}</p>
              </div>

              <div className="agent-timeline">
                {activities.map(
                  (activity, index) => (
                    <div
                      className={`agent-activity agent-activity-${activity.state}`}
                      key={index}
                    >
                      <div className="agent-activity-marker">
                        {activity.state === "done"
                          ? "✓"
                          : activity.state ===
                              "waiting"
                            ? "…"
                            : "🔒"}
                      </div>

                      <div>
                        <strong>
                          {activity.title}
                        </strong>
                        <p>{activity.detail}</p>
                      </div>
                    </div>
                  ),
                )}
              </div>
            </aside>

            <main className="agent-preview-panel">
              <div className="agent-panel-heading">
                <div>
                  <span className="agent-eyebrow">
                    Store Change Preview
                  </span>
                  <h2>Development preview</h2>
                </div>

                <div className="agent-preview-actions">
                  <button
                    onClick={() =>
                      window.open(
                        `https://${shop}`,
                        "_blank",
                        "noopener,noreferrer",
                      )
                    }
                  >
                    Open Store
                  </button>

                  <button
                    onClick={() =>
                      navigate(
                        `/app/developer?planId=${latestPlan.id}`,
                      )
                    }
                  >
                    View Full Plan
                  </button>
                </div>
              </div>

              <div className="agent-preview-toolbar">
                <div className="agent-browser-dots">
                  <span />
                  <span />
                  <span />
                </div>

                <div className="agent-address">
                  https://{shop}
                </div>

                <span className="agent-preview-badge">
                  Preview mode
                </span>
              </div>

              <div className="agent-preview-stage">
                <div className="agent-preview-placeholder">
                  <div className="agent-preview-icon">
                    ◫
                  </div>

                  <h3>
                    Live Shopify preview will appear
                    here
                  </h3>

                  <p>
                    Milestone 5 will connect this
                    workspace to the Shopify execution
                    engine and theme preview flow.
                  </p>

                  <div className="agent-preview-status">
                    <div>
                      <span>Current state</span>
                      <strong>
                        No store changes applied
                      </strong>
                    </div>

                    <div>
                      <span>Prepared changes</span>
                      <strong>
                        {
                          latestPlan.plan
                            .proposedSteps.length
                        }{" "}
                        steps
                      </strong>
                    </div>

                    <div>
                      <span>Approval</span>
                      <strong>
                        {latestPlan.status.replace(
                          /_/g,
                          " ",
                        )}
                      </strong>
                    </div>
                  </div>
                </div>
              </div>

              <div className="agent-change-section">
                <div className="agent-change-header">
                  <div>
                    <span className="agent-eyebrow">
                      Prepared Changes
                    </span>
                    <h3>
                      What the agent intends to change
                    </h3>
                  </div>

                  <span>
                    {
                      latestPlan.plan.proposedSteps
                        .length
                    }{" "}
                    operations
                  </span>
                </div>

                <div className="agent-change-list">
                  {latestPlan.plan.proposedSteps.map(
                    (step, index) => (
                      <article
                        className="agent-change-item"
                        key={step.id}
                      >
                        <div className="agent-change-index">
                          {index + 1}
                        </div>

                        <div className="agent-change-main">
                          <div className="agent-change-title">
                            <strong>
                              {step.title}
                            </strong>

                            <div>
                              <span>
                                {step.category}
                              </span>

                              <span>
                                {
                                  step.operationIntent
                                }
                              </span>

                              <span
                                className={getRiskClass(
                                  step.riskLevel,
                                )}
                              >
                                {step.riskLevel}
                              </span>
                            </div>
                          </div>

                          <p>{step.description}</p>

                          <div className="agent-target">
                            <span>Target</span>
                            <code>
                              {step.target}
                            </code>
                          </div>
                        </div>
                      </article>
                    ),
                  )}
                </div>
              </div>
            </main>

            <aside className="agent-inspector-panel">
              <section className="agent-side-card">
                <span className="agent-eyebrow">
                  Task Inspector
                </span>

                <h3>Plan status</h3>

                <div className="agent-inspector-grid">
                  <div>
                    <span>Status</span>
                    <strong>
                      {latestPlan.status.replace(
                        /_/g,
                        " ",
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>Risk</span>
                    <strong
                      className={getRiskClass(
                        latestPlan.plan.risk
                          .overall,
                      )}
                    >
                      {
                        latestPlan.plan.risk
                          .overall
                      }
                    </strong>
                  </div>

                  <div>
                    <span>Steps</span>
                    <strong>
                      {
                        latestPlan.plan
                          .proposedSteps.length
                      }
                    </strong>
                  </div>

                  <div>
                    <span>Provider</span>
                    <strong>
                      {formatProvider(
                        latestPlan.plan
                          .providerExecution
                          .primaryProvider,
                      )}
                    </strong>
                  </div>
                </div>
              </section>

              <section className="agent-side-card">
                <span className="agent-eyebrow">
                  Store Context
                </span>

                <h3>Latest snapshot</h3>

                {context ? (
                  <div className="agent-context-grid">
                    <div>
                      <strong>
                        {context.products}
                      </strong>
                      <span>Products</span>
                    </div>

                    <div>
                      <strong>
                        {context.collections}
                      </strong>
                      <span>Collections</span>
                    </div>

                    <div>
                      <strong>
                        {context.metafields}
                      </strong>
                      <span>Metafields</span>
                    </div>

                    <div>
                      <strong>
                        {context.metaobjects}
                      </strong>
                      <span>Metaobjects</span>
                    </div>
                  </div>
                ) : (
                  <p className="agent-muted">
                    No context snapshot available.
                  </p>
                )}
              </section>

              <section className="agent-side-card">
                <span className="agent-eyebrow">
                  Required Capabilities
                </span>

                <h3>Permissions</h3>

                <div className="agent-capability-list">
                  {latestPlan.plan
                    .requiredCapabilities.length >
                  0 ? (
                    latestPlan.plan.requiredCapabilities.map(
                      (capability) => (
                        <code key={capability}>
                          {capability}
                        </code>
                      ),
                    )
                  ) : (
                    <span className="agent-muted">
                      None required
                    </span>
                  )}
                </div>
              </section>

              <section className="agent-side-card">
                <span className="agent-eyebrow">
                  Execution Barrier
                </span>

                <div className="agent-security-box">
                  <span>🔒</span>

                  <div>
                    <strong>
                      Shopify writes disabled
                    </strong>

                    <p>
                      Current workspace is planning and
                      inspection only. No mutation has
                      been executed.
                    </p>
                  </div>
                </div>
              </section>
            </aside>
          </div>
        )}
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (
  headersArgs,
) => {
  return boundary.headers(headersArgs);
};