import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useRouteError } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { getLatestStoreContextSnapshot } from "../core/context/context-cache.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Retrieve or initialize StoreSetting for this shop
  let setting = await db.storeSetting.findUnique({
    where: { shop },
  });

  if (!setting) {
    setting = await db.storeSetting.create({
      data: {
        shop,
        activeProvider: null,
        activeModel: null,
        developerMode: false,
        requireApproval: true,
      },
    });
  }

  // Check if the currently active provider is connected and valid
  const activeCred = setting.activeProvider
    ? await db.aiCredential.findUnique({
        where: {
          shop_provider: {
            shop,
            provider: setting.activeProvider,
          },
        },
      })
    : null;

  const isActiveBrainConnected = Boolean(activeCred?.isValid);

  // Count total valid connected credentials
  const validCredentialsCount = await db.aiCredential.count({
    where: {
      shop,
      isValid: true,
    },
  });

  // Check latest Store Context Snapshot
  const contextSnapshot = await getLatestStoreContextSnapshot(shop);

  const productCount =
    contextSnapshot?.summary?.productSummary?.totalCount ?? 0;
  const collectionCount =
    contextSnapshot?.summary?.collectionSummary?.totalCount ?? 0;
  const metafieldCount = Array.isArray(
    contextSnapshot?.summary?.metafieldDefinitions
  )
    ? contextSnapshot.summary.metafieldDefinitions.length
    : 0;
  const metaobjectCount = Array.isArray(
    contextSnapshot?.summary?.metaobjectDefinitions
  )
    ? contextSnapshot.summary.metaobjectDefinitions.length
    : 0;

  const providerNames: Record<string, string> = {
    gemini: "Google Gemini",
    openai: "OpenAI",
    anthropic: "Anthropic Claude",
    openrouter: "OpenRouter",
  };

  const activeProviderName = setting.activeProvider
    ? providerNames[setting.activeProvider] || setting.activeProvider
    : null;

  // Query latest AiPlan for this shop
  const latestPlanRecord = await db.aiPlan.findFirst({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });

  const latestPlan = latestPlanRecord
    ? {
        id: latestPlanRecord.id,
        userRequest: latestPlanRecord.userRequest,
        status: latestPlanRecord.status,
        riskLevel: latestPlanRecord.riskLevel,
        createdAt: latestPlanRecord.createdAt.toISOString(),
        primaryProvider: latestPlanRecord.primaryProvider,
      }
    : null;

  return {
    shop,
    setting: {
      activeProvider: setting.activeProvider,
      activeProviderName,
      activeModel: setting.activeModel,
      developerMode: setting.developerMode,
      requireApproval: setting.requireApproval,
    },
    isActiveBrainConnected,
    validCredentialsCount,
    latestContextSnapshot: contextSnapshot
      ? {
          analyzedAt: contextSnapshot.analyzedAt.toISOString(),
          productCount,
          collectionCount,
          metafieldCount,
          metaobjectCount,
        }
      : null,
    latestPlan,
  };
};

export default function Dashboard() {
  const {
    shop,
    setting,
    isActiveBrainConnected,
    validCredentialsCount,
    latestContextSnapshot,
    latestPlan,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <s-page heading="AI Store Developer">
      {/* Primary Action */}
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate("/app/developer")}
      >
        Open AI Developer
      </s-button>

      {/* Hero Overview */}
      <s-section heading="Overview">
        <s-paragraph>
          Build and manage Shopify functionality using AI. Describe your requirements in natural
          language, review structured technical execution plans, and apply changes safely to your store.
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-button onClick={() => navigate("/app/developer")}>
            Open AI Developer
          </s-button>
          <s-button onClick={() => navigate("/app/connections")}>
            Connect AI Provider
          </s-button>
          <s-button onClick={() => navigate("/app/context")}>
            Inspect Store Context
          </s-button>
        </s-stack>
      </s-section>

      {/* System Status Indicators */}
      <s-section heading="System &amp; Engine Status">
        <s-stack direction="block" gap="base">
          {/* AI Connection Card */}
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="inline" gap="base">
              <s-stack direction="block" gap="none">
                <s-heading>AI Brain Connection</s-heading>
                <s-paragraph>
                  {isActiveBrainConnected && setting.activeProviderName
                    ? `Active Brain: ${setting.activeProviderName}${setting.activeModel ? ` (${setting.activeModel})` : ""}. Ready for AI Developer.`
                    : validCredentialsCount > 0
                    ? "Connected providers available — no active AI selected. Visit AI Connections to select your active brain."
                    : "Not connected. Connect Google Gemini or OpenAI in AI Connections to enable the AI assistant."}
                </s-paragraph>
              </s-stack>
              <s-badge tone={isActiveBrainConnected ? "success" : "caution"}>
                {isActiveBrainConnected
                  ? "Connected"
                  : validCredentialsCount > 0
                  ? "Action Required"
                  : "Not connected"}
              </s-badge>
            </s-stack>
          </s-box>

          {/* Store Context Card */}
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="inline" gap="base">
              <s-stack direction="block" gap="none">
                <s-heading>Store Context Analyzer</s-heading>
                <s-paragraph>
                  {latestContextSnapshot
                    ? `Analyzed • Last analyzed: ${new Date(latestContextSnapshot.analyzedAt).toLocaleString()}`
                    : "Store schema, metafield definitions, and metaobjects have not yet been indexed."}
                </s-paragraph>
                {latestContextSnapshot && (
                  <s-paragraph>
                    <strong>{latestContextSnapshot.productCount.toLocaleString()} Products</strong> •{" "}
                    <strong>{latestContextSnapshot.collectionCount.toLocaleString()} Collections</strong> •{" "}
                    {latestContextSnapshot.metafieldCount} Metafields •{" "}
                    {latestContextSnapshot.metaobjectCount} Metaobjects
                  </s-paragraph>
                )}
              </s-stack>
              <s-stack direction="inline" gap="small">
                <s-badge tone={latestContextSnapshot ? "success" : "info"}>
                  {latestContextSnapshot ? "Analyzed" : "Not analyzed"}
                </s-badge>
                <s-button onClick={() => navigate("/app/context")}>
                  {latestContextSnapshot ? "View Store Context" : "Analyze Store"}
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>

          {/* Safety & Approval Card */}
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="inline" gap="base">
              <s-stack direction="block" gap="none">
                <s-heading>Safety &amp; Approval Barrier</s-heading>
                <s-paragraph>
                  Active • All mutating Shopify operations require merchant review and approval before execution.
                </s-paragraph>
              </s-stack>
              <s-badge tone="success">Safe Mode Active</s-badge>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* Recent Activity / Builds */}
      <s-section heading="Recent Builds &amp; Plans">
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="block" gap="base">
            {latestPlan ? (
              <s-stack direction="block" gap="small">
                <s-stack direction="inline" gap="base">
                  <s-stack direction="block" gap="none">
                    <s-heading>Latest Plan: {latestPlan.userRequest.slice(0, 60)}{latestPlan.userRequest.length > 60 ? "..." : ""}</s-heading>
                    <s-paragraph>
                      Generated via {latestPlan.primaryProvider.toUpperCase()} • Created {new Date(latestPlan.createdAt).toLocaleString()}
                    </s-paragraph>
                  </s-stack>
                  <s-badge
                    tone={
                      latestPlan.status === "APPROVED"
                        ? "success"
                        : latestPlan.status === "REJECTED"
                        ? "critical"
                        : "info"
                    }
                  >
                    {latestPlan.status.replace(/_/g, " ")}
                  </s-badge>
                </s-stack>
                <s-stack direction="inline" gap="base">
                  <s-button variant="primary" onClick={() => navigate(`/app/developer?planId=${latestPlan.id}`)}>
                    Inspect Latest Plan
                  </s-button>
                  <s-button onClick={() => navigate("/app/developer")}>
                    Create Development Plan
                  </s-button>
                  <s-button onClick={() => navigate("/app/history")}>
                    View Build History
                  </s-button>
                </s-stack>
              </s-stack>
            ) : (
              <>
                <s-paragraph>
                  No technical plans generated yet. Prompt the AI Developer to analyze your request and produce
                  a safe implementation plan with diff previews.
                </s-paragraph>
                <s-stack direction="inline" gap="base">
                  <s-button variant="primary" onClick={() => navigate("/app/developer")}>
                    Create Development Plan
                  </s-button>
                  <s-button onClick={() => navigate("/app/history")}>
                    View Build History
                  </s-button>
                </s-stack>
              </>
            )}
          </s-stack>
        </s-box>
      </s-section>

      {/* Connected Store Info */}
      <s-section slot="aside" heading="Connected Store">
        <s-paragraph>
          <s-text>Shop: </s-text>
          <code>{shop}</code>
        </s-paragraph>
        <s-paragraph>
          <s-text>Mode: </s-text>
          <s-badge tone={setting.developerMode ? "warning" : "info"}>
            {setting.developerMode ? "Developer Mode" : "Standard Mode"}
          </s-badge>
        </s-paragraph>
        <s-paragraph>
          <s-text>Scopes: </s-text>
          <code>write_products, write_metaobjects</code>
        </s-paragraph>
      </s-section>

      {/* Quick Documentation & Architecture Rules */}
      <s-section slot="aside" heading="Execution Principles">
        <s-unordered-list>
          <s-list-item>Provider-agnostic planning layer</s-list-item>
          <s-list-item>Zero automatic write operations</s-list-item>
          <s-list-item>Strict schema and risk analysis</s-list-item>
          <s-list-item>Best-effort rollback tracking</s-list-item>
        </s-unordered-list>
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
