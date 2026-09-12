import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  return {
    shop: session.shop,
    scopes: process.env.SCOPES || "write_products,write_metaobjects,write_metaobject_definitions",
  };
};

export default function StoreContext() {
  const { shop, scopes } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <s-page heading="Store Context">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => navigate("/app/developer")}
      >
        Go to AI Developer
      </s-button>

      <s-section heading="Context Collector">
        <s-paragraph>
          To give accurate Shopify recommendations and avoid schema conflicts, the AI engine requires an
          understanding of your store&apos;s custom data architecture.
        </s-paragraph>
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="block" gap="base">
            <s-heading>Store Index Status: Not Analyzed</s-heading>
            <s-paragraph>
              Full store schema scanning and caching will be activated in <strong>Milestone 3</strong>.
              This will inspect existing metafield definitions, metaobjects, and theme extension points.
            </s-paragraph>
            <s-badge tone="info">Pending Milestone 3</s-badge>
          </s-stack>
        </s-box>
      </s-section>

      <s-section heading="Indexed Schemas">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="none">
              <s-heading>Metaobject Definitions</s-heading>
              <s-paragraph>0 definitions currently cached.</s-paragraph>
            </s-stack>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="none">
              <s-heading>Metafield Definitions</s-heading>
              <s-paragraph>0 metafield definitions currently cached.</s-paragraph>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Environment">
        <s-paragraph>
          <s-text>Store: </s-text>
          <code>{shop}</code>
        </s-paragraph>
        <s-paragraph>
          <s-text>Configured Scopes: </s-text>
          <code>{scopes}</code>
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
