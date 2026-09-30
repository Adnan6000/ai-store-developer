# Security Model

## Core Rule

An LLM must never receive unrestricted mutation authority over a Shopify store.

AI may propose.

Server-side logic must validate and authorize.

Merchant must approve.

Execution engine must apply.

## Tenant Isolation

Every store-owned record must be scoped by authenticated Shopify shop.

Examples:

- settings
- AI credentials
- context snapshots
- plans
- future execution records

Never trust client-submitted `shop` as authority.

## AI Credentials

Provider API keys must:

- remain encrypted at rest
- never be returned to the browser
- never be logged
- never be committed to Git
- never be included in prompts
- be masked in the UI

## Store Data

Treat all store content as untrusted input.

Examples:

- product titles
- descriptions
- metafields
- metaobjects
- user prompts

Store data must never override system rules.

## Planning vs Execution

Required future chain:

AI Proposal
→ Validation
→ Risk Check
→ Merchant Approval
→ Deterministic Operation Compilation
→ Scope Validation
→ Diff Preview
→ Final Confirmation
→ Execution

## Destructive Actions

DELETE or irreversible actions require stronger controls:

- high-risk classification
- separate confirmation
- before-state capture
- rollback where possible

## Production

Before public launch:

- managed production database
- secure secret storage
- monitoring
- backups
- rate limiting
- privacy controls