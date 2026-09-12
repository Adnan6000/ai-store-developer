import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  return {
    shop: session.shop,
    totalExecutions: 0,
  };
};

export default function BuildHistory() {
  const { shop, totalExecutions } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <s-page heading="Build History">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate("/app/developer")}
      >
        New AI Request
      </s-button>

      <s-section heading="Execution Log">
        <s-paragraph>
          Complete audit record of every technical plan, merchant approval, and GraphQL mutation executed
          by the application.
        </s-paragraph>

        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="block" gap="base">
            <s-heading>No Execution History</s-heading>
            <s-paragraph>
              No technical plans or changes have been executed yet. When you generate and approve plans in the
              AI Developer, each step and its outcome will be recorded here.
            </s-paragraph>
            <s-stack direction="inline" gap="base">
              <s-button onClick={() => navigate("/app/developer")}>
                Open AI Developer
              </s-button>
            </s-stack>
          </s-stack>
        </s-box>
      </s-section>

      <s-section slot="aside" heading="Rollback Architecture">
        <s-paragraph>
          <s-text><strong>Store: </strong></s-text>
          <code>{shop}</code>
        </s-paragraph>
        <s-paragraph>
          <s-text><strong>Total Executions: </strong></s-text>
          <code>{totalExecutions}</code>
        </s-paragraph>
        <s-paragraph>
          <s-text><strong>Recovery Model: </strong></s-text>
          Best-effort rollback using before-state snapshots, created resource IDs, recovery metadata, and audit logs.
        </s-paragraph>
        <s-paragraph>
          Some external or complex Shopify operations cannot be guaranteed to reverse atomically, so every action
          logs all created entity references for transparent auditing.
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
