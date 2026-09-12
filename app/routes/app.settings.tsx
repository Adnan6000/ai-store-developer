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

  return {
    shop,
    setting: {
      activeProvider: setting?.activeProvider || "gemini",
      activeModel: setting?.activeModel || null,
      developerMode: setting?.developerMode || false,
      requireApproval: setting?.requireApproval ?? true,
    },
  };
};

export default function Settings() {
  const { shop, setting } = useLoaderData<typeof loader>();
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
            <s-heading>Active Brain: {setting.activeProvider.toUpperCase()}</s-heading>
            <s-paragraph>
              Current Model: {setting.activeModel || "Default (Configurable in AI Connections)"}
            </s-paragraph>
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
          <code>1.0.0-m1</code>
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
