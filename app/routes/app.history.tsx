import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useRouteError } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getRecentAiPlans } from "../core/ai/plan-persistence.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const plans = await getRecentAiPlans(shop, 20);

  return {
    shop,
    plans: plans.map((p) => ({
      id: p.id,
      userRequest: p.userRequest,
      status: p.status,
      planningMode: p.planningMode,
      primaryProvider: p.primaryProvider,
      reviewerProvider: p.reviewerProvider,
      riskLevel: p.riskLevel,
      createdAt: p.createdAt.toISOString(),
      approvedAt: p.approvedAt ? p.approvedAt.toISOString() : null,
      summary: p.plan.summary,
      stepsCount: p.plan.proposedSteps.length,
    })),
  };
};

export default function BuildHistory() {
  const { shop, plans } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <s-page heading="Build &amp; Plan History">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate("/app/developer")}
      >
        New AI Request
      </s-button>

      <s-section heading="Planning History Log">
        <s-paragraph>
          Complete history of technical architecture plans, safety assessments, and approval states for store <code>{shop}</code>.
        </s-paragraph>

        {plans.length === 0 ? (
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-heading>No Implementation Plans Found</s-heading>
              <s-paragraph>
                You haven&apos;t generated any development plans yet. Open the AI Developer to describe a feature, fix, or improvement.
              </s-paragraph>
              <s-stack direction="inline" gap="base">
                <s-button onClick={() => navigate("/app/developer")}>
                  Open AI Developer
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            {plans.map((p) => (
              <s-box key={p.id} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" gap="base">
                    <s-stack direction="block" gap="none">
                      <s-heading>{p.summary}</s-heading>
                      <s-paragraph>
                        <em>&ldquo;{p.userRequest}&rdquo;</em>
                      </s-paragraph>
                    </s-stack>
                    <s-stack direction="inline" gap="small">
                      <s-badge
                        tone={
                          p.status === "APPROVED"
                            ? "success"
                            : p.status === "REJECTED"
                            ? "critical"
                            : "info"
                        }
                      >
                        {p.status.replace(/_/g, " ")}
                      </s-badge>
                      <s-badge
                        tone={
                          p.riskLevel === "LOW"
                            ? "success"
                            : p.riskLevel === "MEDIUM"
                            ? "caution"
                            : "critical"
                        }
                      >
                        Risk: {p.riskLevel}
                      </s-badge>
                    </s-stack>
                  </s-stack>

                  <s-stack direction="inline" gap="base">
                    <s-paragraph>
                      <s-text><strong>Engine: </strong></s-text>
                      <code>{p.primaryProvider.toUpperCase()}</code>
                      {p.reviewerProvider && (
                        <>
                          <s-text> + <code>{p.reviewerProvider.toUpperCase()}</code> (Reviewer)</s-text>
                        </>
                      )}
                      <s-text> • <strong>Mode: </strong></s-text>
                      <code>{p.planningMode}</code>
                      <s-text> • <strong>Steps: </strong></s-text>
                      {p.stepsCount}
                      <s-text> • <strong>Created: </strong></s-text>
                      {new Date(p.createdAt).toLocaleString()}
                    </s-paragraph>

                    <s-button onClick={() => navigate(`/app/developer?planId=${p.id}`)}>
                      Inspect Plan
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section slot="aside" heading="Multi-Tenant Isolation">
        <s-paragraph>
          <s-text><strong>Store: </strong></s-text>
          <code>{shop}</code>
        </s-paragraph>
        <s-paragraph>
          <s-text><strong>Plans Recorded: </strong></s-text>
          <code>{plans.length}</code>
        </s-paragraph>
        <s-paragraph>
          All planning history is isolated to your authenticated store session. Cross-shop data access is prevented at the database and query layer.
        </s-paragraph>
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
