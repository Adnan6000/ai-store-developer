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

  const credentialCount = await db.aiCredential.count({
    where: { shop, isValid: true },
  });

  return {
    shop,
    hasAiConnected: credentialCount > 0,
    activeProvider: setting?.activeProvider || "gemini",
  };
};

export default function AiDeveloper() {
  const { hasAiConnected, activeProvider } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <s-page heading="AI Developer">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate("/app/connections")}
      >
        {hasAiConnected ? "Manage Connections" : "Connect AI Provider"}
      </s-button>

      <s-section heading="Prompt Studio">
        <s-paragraph>
          Describe the feature or functionality you want to build for your Shopify store. The AI engine will
          analyze your store context and generate a safe, step-by-step technical execution plan.
        </s-paragraph>

        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="block" gap="base">
            <s-heading>Interactive Prompt Composer</s-heading>
            <s-paragraph>
              <em>Example: &ldquo;Create a made-to-measure product configurator with width and height validation and preserve the configuration in the Shopify order.&rdquo;</em>
            </s-paragraph>
            <s-box padding="base" borderWidth="base" borderRadius="base" background="base">
              <s-paragraph>
                <strong>Engine State:</strong> Foundation Ready. Full prompt-to-plan pipeline will activate in <strong>Milestone 4</strong>.
              </s-paragraph>
            </s-box>
            <s-stack direction="inline" gap="base">
              <s-button onClick={() => navigate("/app/connections")}>
                Verify AI Provider ({activeProvider.toUpperCase()})
              </s-button>
              <s-button onClick={() => navigate("/app/context")}>
                View Store Context
              </s-button>
            </s-stack>
          </s-stack>
        </s-box>
      </s-section>

      <s-section heading="Execution Plan Preview">
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="block" gap="base">
            <s-heading>Plan &amp; Diff Staging Area</s-heading>
            <s-paragraph>
              Generated plans will appear here showing all proposed GraphQL operations, custom data schemas,
              and risk levels before any changes are made to your store.
            </s-paragraph>
          </s-stack>
        </s-box>
      </s-section>

      <s-section slot="aside" heading="Safety Workflow">
        <s-ordered-list>
          <s-list-item>Natural language request</s-list-item>
          <s-list-item>Store context inspection</s-list-item>
          <s-list-item>Technical plan generation</s-list-item>
          <s-list-item>Visual diff preview</s-list-item>
          <s-list-item>Mandatory merchant approval</s-list-item>
          <s-list-item>Safe execution with rollback log</s-list-item>
        </s-ordered-list>
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
