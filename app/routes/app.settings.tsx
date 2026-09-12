import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const setting = await db.storeSetting.findUnique({
    where: { shop },
  });

  const activeProvider = setting?.activeProvider || null;
  const activeCred = activeProvider
    ? await db.aiCredential.findUnique({
        where: {
          shop_provider: {
            shop,
            provider: activeProvider,
          },
        },
      })
    : null;

  const validCredentialsCount = await db.aiCredential.count({
    where: {
      shop,
      isValid: true,
    },
  });

  const providerNames: Record<string, string> = {
    gemini: "Google Gemini",
    openai: "OpenAI",
    anthropic: "Anthropic Claude",
    openrouter: "OpenRouter",
  };

  const activeProviderName = activeProvider
    ? providerNames[activeProvider] || activeProvider
    : null;

  return {
    shop,
    setting: {
      activeProvider,
      activeProviderName,
      activeModel: setting?.activeModel || null,
      developerMode: setting?.developerMode || false,
      requireApproval: setting?.requireApproval ?? true,
    },
    isActiveConnected: Boolean(activeCred?.isValid),
    validCredentialsCount,
  };
};

export default function Settings() {
  const { shop, setting, isActiveConnected, validCredentialsCount } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <s-page heading="Settings">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate("/app")}
      >
        Back to Dashboard
      </s-button>

      <s-section heading="Safety &amp; Execution Preferences">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="inline" gap="base">
              <s-stack direction="block" gap="none">
                <s-heading>Strict Approval Gate</s-heading>
                <s-paragraph>
                  Require explicit merchant approval and diff inspection before executing any mutating Shopify operation.
                </s-paragraph>
              </s-stack>
              <s-badge tone="success">
                {setting.requireApproval ? "Enforced" : "Optional"}
              </s-badge>
            </s-stack>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="inline" gap="base">
              <s-stack direction="block" gap="none">
                <s-heading>Developer Mode</s-heading>
                <s-paragraph>
                  Show raw GraphQL queries, mutation variables, AST trees, and detailed execution payloads.
                </s-paragraph>
              </s-stack>
              <s-badge tone={setting.developerMode ? "warning" : "info"}>
                {setting.developerMode ? "Enabled" : "Disabled (Standard Mode)"}
              </s-badge>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="Provider Configuration">
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base">
              <s-stack direction="block" gap="none">
                <s-heading>
                  {isActiveConnected && setting.activeProviderName
                    ? `Active Brain: ${setting.activeProviderName}`
                    : validCredentialsCount > 0
                    ? "Connected providers available — no active AI selected"
                    : "Not connected"}
                </s-heading>
                <s-paragraph>
                  {isActiveConnected && setting.activeProviderName
                    ? `Current Model: ${setting.activeModel || "Default (Configurable in AI Connections)"}`
                    : validCredentialsCount > 0
                    ? "You have verified AI connections available, but no active provider is selected. Select an active brain in AI Connections."
                    : "No AI provider connected. Connect Google Gemini or OpenAI in AI Connections to get started."}
                </s-paragraph>
              </s-stack>
              <s-badge
                tone={
                  isActiveConnected
                    ? "success"
                    : validCredentialsCount > 0
                    ? "caution"
                    : "caution"
                }
              >
                {isActiveConnected
                  ? "Connected"
                  : validCredentialsCount > 0
                  ? "Action Required"
                  : "Not connected"}
              </s-badge>
            </s-stack>
            <s-stack direction="inline" gap="base">
              <s-button onClick={() => navigate("/app/connections")}>
                Configure Providers
              </s-button>
            </s-stack>
          </s-stack>
        </s-box>
      </s-section>

      <s-section slot="aside" heading="Application Info">
        <s-paragraph>
          <s-text>Shop: </s-text>
          <code>{shop}</code>
        </s-paragraph>
        <s-paragraph>
          <s-text>Version: </s-text>
          <code>1.0.0-m2</code>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(boundary);
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
