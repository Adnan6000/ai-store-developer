# AI Store Developer — Project Overview

AI Store Developer is a Shopify embedded SaaS application intended to become a store-aware development agent for Shopify merchants and developers.

## Product Vision

The product should not behave like a generic chatbot.

Its long-term role is to act as a complete Shopify development workspace capable of:

- natural-language development requests
- bug fixing
- custom Shopify development
- visual design implementation
- screenshot/image-to-Shopify implementation
- Figma-to-Shopify implementation
- store architecture analysis
- safe Shopify execution
- code and resource diffs
- validation
- approvals
- audit history
- rollback

## Core Product Principles

- Shopify-native embedded application
- multi-tenant isolation by authenticated shop
- provider-agnostic AI architecture
- merchant-controlled AI credentials
- store-aware reasoning
- structured planning instead of uncontrolled execution
- explicit merchant approval
- deterministic server-side validation
- least-privilege Shopify scopes
- auditable history
- safe rollback wherever possible
- strong performance
- premium developer-grade UI
- Shopify App Store compliance

## Current Stack

- Shopify embedded app
- React Router 7
- React 18
- Shopify App Bridge
- Shopify React Router package
- Prisma
- SQLite for local development
- TypeScript
- Vite
- OpenAI
- Google Gemini
- Shopify Admin GraphQL API

## Current Stage

Milestones 1–3 are implemented.

Milestone 4 — AI Planning & Approval Engine — is currently in stabilization.

Milestone 5 — Safe Shopify Execution Engine — has not yet been implemented.

## Long-Term Workflow

Merchant Request
→ Store Context
→ AI Planning
→ Server Validation
→ Risk Classification
→ Merchant Approval
→ Execution Preparation
→ Change Preview / Diff
→ Final Confirmation
→ Shopify Execution
→ Verification
→ Audit Trail
→ Rollback