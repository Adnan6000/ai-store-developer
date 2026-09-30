# UX & Product Experience Specification

## Product Experience Goal

AI Store Developer should feel like a modern Shopify developer workspace, not a generic AI chatbot.

## Recommended Layout

```text
┌───────────────────────────────────────────────────────────────┐
│ Store / Environment / Safety / Current Build                 │
├──────────────┬─────────────────────────────┬──────────────────┤
│ Project Rail │ Main Developer Workspace    │ Inspector        │
│              │                             │                  │
│ Home         │ Prompt / Plan / Execution   │ Store Context    │
│ Developer    │                             │ Theme Files      │
│ Designs      │                             │ Diff Preview     │
│ Bug Fix      │                             │ Risks / Scopes   │
│ Context      │                             │                  │
│ History      │                             │                  │
└──────────────┴─────────────────────────────┴──────────────────┘
```

## UX Principles

### Task First

A task is the main object.

A task should contain:

- title
- request
- references
- store context
- design references
- plan
- risks
- approvals
- operations
- execution status
- verification
- rollback state

### Progressive Disclosure

Three levels:

- Simple
- Technical
- Expert

### Visual Review

Before execution show:

- exact changes
- affected files/resources
- before/after
- scopes
- risk
- reversibility
- expected outcome

### Persistent Project Memory

Each store should retain:

- brand rules
- theme conventions
- design system
- reusable components
- previous decisions
- rejected approaches
- store constraints

## Main Workspaces

### Command Center

Show:

- connected store
- AI provider
- context freshness
- active tasks
- latest builds
- pending approvals
- recent failures

### AI Developer

Input support:

- natural language
- screenshots
- images
- Figma links
- URLs
- code snippets
- error logs

### Design Workspace

Workflow:

Reference
→ visual analysis
→ design tokens
→ responsive interpretation
→ Shopify component mapping
→ implementation plan
→ preview
→ visual QA
→ approval

### Bug Fix Workspace

Workflow:

Issue
→ diagnose
→ root cause
→ proposed fix
→ diff
→ validation
→ approval
→ apply
→ verify

### Diff & Approval Center

Must show:

- exact resource changes
- code diff
- data mutations
- warnings
- rollback availability
- approval controls

## Performance UX

- fast navigation feedback
- skeleton states
- cached store context
- streaming execution status
- paginated history
- incremental loading
- lazy-loaded technical detail
- avoid repeated full-store scans