import db from "../../db.server";
import type { StoreContextSummary } from "./types";

const CURRENT_SCHEMA_VERSION = 1;
const MAX_SNAPSHOT_HISTORY_PER_SHOP = 5;

export interface PersistedSnapshot {
  id: string;
  shop: string;
  schemaVersion: number;
  analyzedAt: Date;
  summary: StoreContextSummary;
}

/**
 * Safely serializes StoreContextSummary to a JSON string.
 * Ensures BigInt and undefined values do not crash serialization.
 */
export function safeSerializeSummary(summary: StoreContextSummary): string {
  try {
    return JSON.stringify(summary, (_key, value) => {
      if (typeof value === "bigint") {
        return value.toString();
      }
      return value;
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[StoreContext] Snapshot JSON serialization failed:", msg);
    throw new Error("Store context summary could not be serialized for persistence.");
  }
}

/**
 * Persists a fresh StoreContextSummary snapshot to the database.
 * Scoped strictly to the authenticated shop.
 */
export async function saveStoreContextSnapshot(
  shop: string,
  summary: StoreContextSummary
): Promise<PersistedSnapshot> {
  const analyzedAt = new Date(summary.analyzedAt);
  const summaryJson = safeSerializeSummary(summary);

  const snapshot = await db.storeContextSnapshot.create({
    data: {
      shop,
      summaryJson,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      analyzedAt,
    },
  });

  // Keep a small snapshot history (prune snapshots older than the most recent N)
  try {
    const excessSnapshots = await db.storeContextSnapshot.findMany({
      where: { shop },
      orderBy: { analyzedAt: "desc" },
      skip: MAX_SNAPSHOT_HISTORY_PER_SHOP,
      select: { id: true },
    });

    if (excessSnapshots.length > 0) {
      await db.storeContextSnapshot.deleteMany({
        where: {
          id: { in: excessSnapshots.map((s) => s.id) },
        },
      });
    }
  } catch {
    // Non-blocking cleanup failure
  }

  return {
    id: snapshot.id,
    shop: snapshot.shop,
    schemaVersion: snapshot.schemaVersion,
    analyzedAt: snapshot.analyzedAt,
    summary,
  };
}

/**
 * Retrieves the latest analyzed StoreContextSnapshot for a shop.
 * Returns null if the store has never been analyzed.
 */
export async function getLatestStoreContextSnapshot(
  shop: string
): Promise<PersistedSnapshot | null> {
  const record = await db.storeContextSnapshot.findFirst({
    where: { shop },
    orderBy: { analyzedAt: "desc" },
  });

  if (!record) {
    return null;
  }

  try {
    const summary = JSON.parse(record.summaryJson) as StoreContextSummary;
    return {
      id: record.id,
      shop: record.shop,
      schemaVersion: record.schemaVersion,
      analyzedAt: record.analyzedAt,
      summary,
    };
  } catch {
    return null;
  }
}
