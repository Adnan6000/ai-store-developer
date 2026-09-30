# AI Store Developer — Architecture

## High-Level Architecture

Merchant
↓
Embedded Shopify App
↓
Store Settings / AI Connections / Store Context
↓
AI Planning Orchestrator
↓
Provider Routing / Model Selection
↓
Structured Plan Generation
↓
Validation / Risk Classification
↓
Plan Persistence
↓
Merchant Approval
↓
Future Deterministic Execution Engine
↓
Shopify APIs / Theme Operations
↓
Verification / Audit / Rollback

## Current Core Areas

### Shopify Authentication

Primary file:

`app/shopify.server.ts`

Responsibilities:

- Shopify embedded-app configuration
- authenticated admin session
- store identity
- Admin API access

### Database

Primary file:

`prisma/schema.prisma`

Current models:

- `Session`
- `StoreSetting`
- `AiCredential`
- `StoreContextSnapshot`
- `AiPlan`

### Security

Primary area:

`app/core/security/`

Responsibilities:

- encrypted AI credentials
- secret protection
- per-shop isolation
- future execution controls

### Store Context

Primary area:

`app/core/context/`

Responsibilities:

- inspect the authenticated store
- summarize products and collections
- inspect metafields
- inspect metaobjects
- identify granted scopes
- persist context snapshots
- provide bounded context to AI

### AI Planning Layer

Primary area:

`app/core/ai/`

Important files:

- `provider.factory.server.ts`
- `provider-router.server.ts`
- `model-selection.server.ts`
- `context-projection.server.ts`
- `plan-validator.server.ts`
- `plan-persistence.server.ts`
- `error-classifier.server.ts`
- `providers/gemini.provider.server.ts`
- `providers/openai.provider.server.ts`
- `types.ts`

## Current Planning Flow

Merchant Prompt
↓
Authenticated Shop
↓
Latest Store Context Snapshot
↓
Connected AI Credentials
↓
Preferred Provider
↓
Failover Providers
↓
Structured AI Plan
↓
Malformed JSON Repair
↓
Optional Secondary AI Review
↓
Server-Side Validation
↓
Risk Classification
↓
AiPlan Persistence
↓
Merchant Approve / Reject

## Important Architectural Boundary

Planning and execution are separate systems.

The AI planning engine must never directly perform arbitrary Shopify mutations.

Future writes must pass through:

AI Proposal
→ Server Validation
→ Capability Authorization
→ Scope Check
→ Diff / Preview
→ Merchant Approval
→ Deterministic Execution
→ Verification
→ Audit
→ Rollback