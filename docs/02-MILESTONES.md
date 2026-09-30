# Milestones & Roadmap

Legend:

- ✅ Complete
- 🟡 In Progress / Stabilization
- ⬜ Planned

## Milestone 1 — SaaS Foundation ✅

Implemented:

- Shopify React Router scaffold
- embedded app architecture
- Shopify authentication
- Prisma database
- per-shop StoreSetting
- basic settings architecture
- multi-tenant foundation

Commit:

`e43930c`

## Milestone 2 — Secure AI Provider Connections ✅

Implemented:

- encrypted AI credentials
- provider validation
- Gemini adapter
- OpenAI adapter
- active provider selection
- active model setting
- provider factory

Commit:

`79fefeb`

## Milestone 3 — Store Context Analyzer ✅

Implemented:

- store analyzer
- product summary
- collection summary
- metafield definitions
- metaobject definitions
- granted scopes
- context snapshot persistence
- context UI

Commit:

`8adce02`

## Milestone 4 — AI Planning & Approval Engine 🟡

Implemented / WIP:

- provider routing
- failover
- context projection
- structured plan schema
- malformed JSON repair
- optional secondary AI review
- risk classification
- plan validation
- plan persistence
- Standard mode
- Reviewed mode
- merchant approve/reject
- plan history
- recent-plan dashboard state
- explicit no-execution safety barrier

Current checkpoint:

`3c9ddf4`

### Milestone 4 Remaining Work

- fully wire `model-selection.server.ts`
- finalize provider failover semantics
- finalize reviewer `suggestedStepModifications` policy
- verify Prisma migration state
- runtime-test Standard mode
- runtime-test Reviewed mode
- test malformed JSON repair
- test blocked plans
- verify cross-shop isolation
- finalize Milestone 4 commit

## Milestone 4.5 — UX Foundation ⬜

Goal:

Transform the current app from a functional Shopify AI tool into a premium developer-grade workspace.

Planned areas:

- command center
- advanced developer workspace
- design workspace
- bug-fix workspace
- diff inspector
- approval center
- task-based navigation
- persistent project memory
- visual references
- image upload
- Figma input support
- streaming task status
- simple / technical / expert views

## Milestone 5 — Safe Shopify Execution Engine ⬜

Planned:

- execution operation schema
- supported-operation registry
- capability resolver
- Shopify scope validation
- preflight checks
- deterministic operations
- diff / preview
- final execution approval
- Admin GraphQL executor
- verification
- execution status machine
- idempotency
- audit log
- rollback metadata

Initial safe operation families:

1. metafield definition create/update
2. metaobject definition create/update
3. controlled product metafield update
4. limited product-field update

Theme-code mutation should not be the first execution capability.

## Milestone 6 — Recovery, Audit & Rollback ⬜

- execution records
- before-state snapshots
- rollback
- retries
- partial-failure handling
- audit timeline
- recovery UI

## Milestone 7 — Advanced Developer Capabilities ⬜

- theme inspection
- Liquid development
- section/snippet creation
- image-to-Shopify implementation
- Figma-to-Shopify implementation
- theme bug fixing
- Theme App Extensions
- SEO operations
- performance optimization
- reusable skills
- project memory

## Milestone 8 — Commercial SaaS Layer ⬜

- Shopify billing
- subscription plans
- usage metering
- AI quotas
- onboarding
- tenant lifecycle
- support tooling
- analytics

## Milestone 9 — Shopify App Store Launch ⬜

- production hosting
- managed production database
- privacy
- compliance
- uninstall cleanup
- billing QA
- monitoring
- security review
- accessibility
- performance review
- multi-store QA
- App Store listing