import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

type Actor = {
  actorName: string;
  actorEmail: string;
  actorRole: Doc<"users">["role"];
};

type AuditEntry = {
  action: Doc<"auditLogs">["action"];
  entityType: Doc<"auditLogs">["entityType"];
  entityId: string;
  entityName: string;
  summary: string;
  details?: unknown;
};

/**
 * Append to the audit log. Mutations call this instead of inserting directly so
 * the actor fields stay uniform across every write path.
 */
export async function logAudit(ctx: MutationCtx, actor: Actor, entry: AuditEntry) {
  await ctx.db.insert("auditLogs", {
    timestamp: Date.now(),
    actorName: actor.actorName,
    actorEmail: actor.actorEmail,
    actorRole: actor.actorRole,
    ...entry,
  });
}

/** Currency formatting for audit summaries. */
export function usd(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}
