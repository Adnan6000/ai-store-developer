# Architecture Decision Log

## ADR-001 — Shopify Embedded App

Decision:

Build as a Shopify embedded application.

## ADR-002 — Multi-Tenant Isolation

Decision:

All store-owned records are scoped by authenticated shop.

## ADR-003 — BYOK AI Credentials

Decision:

Merchants can connect their own AI providers.

## ADR-004 — Provider-Agnostic AI Layer

Decision:

AI functionality uses provider adapters rather than one hard-coded provider.

## ADR-005 — Store Context Snapshots

Decision:

AI uses bounded persisted snapshots instead of unlimited store data access on every prompt.

## ADR-006 — Planning and Execution Separation

Decision:

AI planning never directly mutates Shopify.

## ADR-007 — Merchant Approval Barrier

Decision:

Future execution requires explicit merchant approval.

## ADR-008 — Deterministic Execution

Decision:

Shopify writes will be executed by deterministic server-side operation handlers.

## ADR-009 — Reviewed Planning Mode

Decision:

A second connected provider may review a primary AI plan.

Open question:

How reviewer-suggested step modifications should be applied.

## ADR-010 — Failover Philosophy

Decision:

One failed provider must not make the system unavailable if another healthy provider exists.

## ADR-011 — Task-First UX

Decision:

The primary UI object is a development task, not a chat conversation.

## ADR-012 — Shopify-Native Integration Preference

Decision:

Use Shopify-native integration methods such as Theme App Extensions where appropriate before direct theme-code mutation.