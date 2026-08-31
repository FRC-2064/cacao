import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id, TableNames } from "./_generated/dataModel";

type Actor = {
  userId: Doc<"users">["_id"];
};

type AuditEntry = {
  action: Doc<"auditLogs">["action"];
  entityType: Doc<"auditLogs">["entityType"];
  entityId: string;
  change?: { field: string; from: string; to: string };
};

/**
 * Append to the audit log. Mutations call this instead of inserting directly so
 * the actor fields stay uniform across every write path.
 */
export async function logAudit(ctx: MutationCtx, actor: Actor, entry: AuditEntry) {
  await ctx.db.insert("auditLogs", {
    userId: actor.userId,
    ...entry,
  });
}

/**
 * Throw unless the row a mutation is about to reference actually exists.
 *
 * `v.id("accounts")` checks that a string is a well-formed id **for that
 * table**. It does not check that the row is still there, and nothing else on
 * the write side did either -- so every `v.id(...)` mutation argument was a
 * dangling reference waiting to be written. Proved by execution: insert two
 * accounts, delete one, call `income.add` with the deleted id, and the
 * mutation was accepted.
 *
 * That matters most where a *read* resolves the reference and cannot carry on
 * without it. `income.list` -- the unauthenticated public financials query --
 * resolves `accountId` through a map and throws on a miss, so one such row
 * takes the public page down for every visitor with no in-app way back: the
 * mutations that could repair the deposit need its id, which comes from the
 * query that is now throwing. And the live path to it is ordinary, not
 * exotic: `seed.importAll` wipes every table and re-creates each row with a
 * fresh `_id`, so any client still holding a pre-import snapshot -- an open
 * form, a queued write -- posts an id that no longer resolves.
 *
 * The optional case is quieter and worse rather than better: a stale
 * `expenses.accountId` never throws on read, it emits `account: undefined`
 * and the expense files under neither account's balance, silently.
 *
 * `undefined` is skipped, so an optional argument reads the same as a
 * required one at the call site. The cost is one document read per reference
 * per write, which is why the invariant lives here on the write path rather
 * than being re-checked on every read.
 *
 * **What the sweep deliberately does not call.** Every cross-table `v.id(...)`
 * argument on the mutation surface goes through here -- none is exempted as
 * "decorative". What is left out is the other kind: the id of the row the
 * mutation is *editing* rather than referencing (`expenses.update.id`,
 * `wishlist.remove.id`, `users.setUserRole.userId`, the array in
 * `teamInfo.reorder`, `sessions.remove.id`). Those store no reference, and a
 * missing row already fails loudly -- each handler either `ctx.db.get`s it
 * and throws, or reaches `ctx.db.patch`/`ctx.db.delete`, which throw on a
 * document that is not there. Adding a read in front of those would buy a
 * nicer message and nothing else.
 */
export async function assertRef<T extends TableNames>(
  ctx: QueryCtx | MutationCtx,
  table: T,
  id: Id<T> | undefined
): Promise<void> {
  if (id === undefined) return;
  const row = await ctx.db.get(table, id);
  if (!row) {
    throw new Error(
      `No row in ${table} with id ${id}. It was probably deleted -- reload and try again.`
    );
  }
}

/**
 * The `YYYY-YYYY` season a calendar day falls in. An FRC season runs September
 * to August, so a spring date belongs to the year before it.
 *
 * Deliberately duplicated from `src/lib/finance/dates.ts`: that module reaches
 * the browser through the `$lib` alias, which a Convex function cannot resolve.
 * Keep the two in step -- they are four lines of the same calendar rule.
 */
export function seasonForDate(iso: string): string {
  const [year, month] = iso.split("-").map(Number);
  const start = month >= 9 ? year : year - 1;
  return `${start}-${start + 1}`;
}
