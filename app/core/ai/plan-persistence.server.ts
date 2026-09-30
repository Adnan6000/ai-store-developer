import db from "../../db.server";
import type { AiDevelopmentPlan, PlanStatus } from "./types";

/**
 * Valid plan status transitions.
 * A plan may only move along these defined paths.
 */
const VALID_STATUS_TRANSITIONS: Record<PlanStatus, readonly PlanStatus[]> = {
  DRAFT: ["READY_FOR_REVIEW", "FAILED"],
  READY_FOR_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: [], // Terminal state — no further transitions
  REJECTED: [], // Terminal state — no further transitions
  FAILED: [],   // Terminal state — no further transitions
} as const;

function isValidTransition(from: PlanStatus, to: PlanStatus): boolean {
  return VALID_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface PersistedAiPlan {
  id: string;
  shop: string;
  userRequest: string;
  status: PlanStatus;
  planningMode: string;
  primaryProvider: string;
  reviewerProvider: string | null;
  contextSnapshotId: string | null;
  riskLevel: string;
  createdAt: Date;
  updatedAt: Date;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  plan: AiDevelopmentPlan;
}

/**
 * Persists an AI-generated technical plan to the database.
 * Scoped strictly to the authenticated shop.
 */
export async function saveAiPlan(
  plan: AiDevelopmentPlan,
  contextSnapshotId: string | null = null
): Promise<PersistedAiPlan> {
  const planJson = JSON.stringify(plan);

  const record = await db.aiPlan.create({
    data: {
      id: plan.planId,
      shop: plan.shop,
      userRequest: plan.userRequest,
      planJson,
      status: plan.approval.status,
      planningMode: plan.providerExecution.requestedMode,
      primaryProvider: plan.providerExecution.primaryProvider,
      reviewerProvider: plan.providerExecution.reviewerProvider || null,
      contextSnapshotId: contextSnapshotId || plan.contextReference.snapshotId || null,
      riskLevel: plan.risk.overall,
    },
  });

  return {
    id: record.id,
    shop: record.shop,
    userRequest: record.userRequest,
    status: record.status as PlanStatus,
    planningMode: record.planningMode,
    primaryProvider: record.primaryProvider,
    reviewerProvider: record.reviewerProvider,
    contextSnapshotId: record.contextSnapshotId,
    riskLevel: record.riskLevel,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    approvedAt: record.approvedAt,
    rejectedAt: record.rejectedAt,
    plan,
  };
}

/**
 * Retrieves a plan by ID, strictly enforcing multi-tenant isolation with session.shop.
 */
export async function getAiPlanById(
  shop: string,
  planId: string
): Promise<PersistedAiPlan | null> {
  const record = await db.aiPlan.findFirst({
    where: {
      id: planId,
      shop,
    },
  });

  if (!record) {
    return null;
  }

  try {
    const plan = JSON.parse(record.planJson) as AiDevelopmentPlan;
    return {
      id: record.id,
      shop: record.shop,
      userRequest: record.userRequest,
      status: record.status as PlanStatus,
      planningMode: record.planningMode,
      primaryProvider: record.primaryProvider,
      reviewerProvider: record.reviewerProvider,
      contextSnapshotId: record.contextSnapshotId,
      riskLevel: record.riskLevel,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      approvedAt: record.approvedAt,
      rejectedAt: record.rejectedAt,
      plan,
    };
  } catch {
    return null;
  }
}

/**
 * Approves an AI development plan.
 *
 * CRITICAL SAFETY REQUIREMENT:
 * This operation ONLY modifies the plan status in the local database.
 * It performs ZERO Shopify GraphQL mutations and ZERO external writes.
 */
export async function approveAiPlan(
  shop: string,
  planId: string
): Promise<PersistedAiPlan> {
  const existing = await getAiPlanById(shop, planId);
  if (!existing) {
    throw new Error("Plan not found or access denied.");
  }

  // Enforce safe state transition
  const currentStatus = existing.status;
  if (!isValidTransition(currentStatus, "APPROVED")) {
    throw new Error(
      `Cannot approve plan: current status is '${currentStatus}'. Only plans in 'READY_FOR_REVIEW' can be approved.`
    );
  }

  const now = new Date();
  const updatedPlan: AiDevelopmentPlan = {
    ...existing.plan,
    approval: {
      ...existing.plan.approval,
      status: "APPROVED",
    },
  };

  const updatedRecord = await db.aiPlan.update({
    where: { id: planId },
    data: {
      status: "APPROVED",
      approvedAt: now,
      planJson: JSON.stringify(updatedPlan),
    },
  });

  return {
    ...existing,
    status: "APPROVED",
    approvedAt: now,
    updatedAt: updatedRecord.updatedAt,
    plan: updatedPlan,
  };
}

/**
 * Rejects an AI development plan.
 */
export async function rejectAiPlan(
  shop: string,
  planId: string
): Promise<PersistedAiPlan> {
  const existing = await getAiPlanById(shop, planId);
  if (!existing) {
    throw new Error("Plan not found or access denied.");
  }

  // Enforce safe state transition
  const currentStatus = existing.status;
  if (!isValidTransition(currentStatus, "REJECTED")) {
    throw new Error(
      `Cannot reject plan: current status is '${currentStatus}'. Only plans in 'READY_FOR_REVIEW' can be rejected.`
    );
  }

  const now = new Date();
  const updatedPlan: AiDevelopmentPlan = {
    ...existing.plan,
    approval: {
      ...existing.plan.approval,
      status: "REJECTED",
    },
  };

  const updatedRecord = await db.aiPlan.update({
    where: { id: planId },
    data: {
      status: "REJECTED",
      rejectedAt: now,
      planJson: JSON.stringify(updatedPlan),
    },
  });

  return {
    ...existing,
    status: "REJECTED",
    rejectedAt: now,
    updatedAt: updatedRecord.updatedAt,
    plan: updatedPlan,
  };
}

/**
 * Fetches recent plans for a shop, limited to the latest N records.
 * Scoped strictly to session.shop.
 */
export async function getRecentAiPlans(
  shop: string,
  limit = 20
): Promise<PersistedAiPlan[]> {
  const records = await db.aiPlan.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return records
    .map((record) => {
      try {
        const plan = JSON.parse(record.planJson) as AiDevelopmentPlan;
        return {
          id: record.id,
          shop: record.shop,
          userRequest: record.userRequest,
          status: record.status as PlanStatus,
          planningMode: record.planningMode,
          primaryProvider: record.primaryProvider,
          reviewerProvider: record.reviewerProvider,
          contextSnapshotId: record.contextSnapshotId,
          riskLevel: record.riskLevel,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          approvedAt: record.approvedAt,
          rejectedAt: record.rejectedAt,
          plan,
        };
      } catch {
        return null;
      }
    })
    .filter((p): p is PersistedAiPlan => p !== null);
}
