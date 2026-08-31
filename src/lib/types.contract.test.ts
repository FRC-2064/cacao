/**
 * The contract between the Convex queries and `$lib/types`.
 *
 * Every read interface in `types.ts` describes a **wire projection**: an
 * explicit allowlist a query rebuilds each row from, not the stored document.
 * Nothing links the two but discipline, and the branch has already shipped
 * three defects of exactly the shape "a projection quietly stopped emitting a
 * field, the client type still claimed it, and the app computed a
 * plausible-looking wrong number" -- a dropped `purchasedAt`/`reimbursedAt`
 * moving account balances, a renamed deposit account key breaking the HCB
 * dedup, and a dropped season tag refiling grant money into the wrong year.
 *
 * These assertions are that link. Each one says: the element type this query
 * actually returns satisfies the interface the client reads it as, and emits
 * every field that interface declares -- optional ones included, which is the
 * part that does the real work (see `Assignable` below). Drop a field from a
 * projection, or rename one, and this file stops compiling under
 * `npm run check`.
 *
 * There is nothing to execute here -- the assertions are types, and they are
 * checked by the type checker, not by a test runner. The file is named
 * `.test.ts` so it reads as what it is; `vitest` has no project that includes
 * it and will not collect it.
 *
 * Note the direction: `Assignable<Projection, Interface>` requires the
 * *projection* to satisfy the *interface*. A field the query emits but the
 * interface omits is allowed (the client simply ignores it); a field the
 * interface promises but the query stopped sending is an error. That is the
 * asymmetry worth catching -- it is the one that produces wrong numbers
 * rather than dead code.
 *
 * **What this file does not cover.** It guards each projection against its
 * interface, not each interface against its consumers. Loosen an interface and
 * the projection that feeds it in the same change and nothing here fires --
 * the two would still agree, and every consumer downstream would quietly start
 * reading `undefined`. The partial defence is the finance-module block at the
 * bottom: those assertions are owned by modules that genuinely need the
 * fields, so the requirement comes from a place that cannot be relaxed by
 * editing `types.ts`. Extending that block is how you close more of this hole;
 * adding another `_Thing` at the top is not.
 */
import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../convex/_generated/api';
import type {
  AuditLog,
  Contact,
  Donor,
  Expense,
  Grant,
  HcbCategoryRow,
  IncomeDeposit,
  Season,
  Sponsor,
  TeamInfoField,
  User,
  WishlistItem
} from '$lib/types';

/** Fails to compile unless `T` is exactly `true`. */
type Expect<T extends true> = T;

/**
 * `true` when the projection satisfies the interface **and** actually emits
 * every key the interface declares; otherwise the keys it is missing, which
 * `Expect` then rejects by name.
 *
 * The second half is not decoration, and leaving it out makes this whole file
 * vacuous for exactly the fields that matter. Assignability alone does not
 * catch a dropped *optional* property: `{ a: 1 }` satisfies `{ a: number;
 * b?: number }` perfectly happily. Nearly every field on these projections is
 * optional, because a Convex `v.optional()` column arrives as `T | undefined`
 * -- `purchasedAt` and `reimbursedAt` among them, and their disappearance from
 * `expenses.list` moved real account balances on this branch. That is the
 * defect this file exists to stop recurring, and the constraint on its own
 * would have sailed straight past it. Measured, not assumed: deleting
 * `receivedAt` from the expenses projection left `npm run check` clean with
 * assignability alone, and fails it with the key check.
 *
 * The reverse direction is deliberately not checked. A query may emit a field
 * no interface names -- that is dead weight on the wire, not a wrong number.
 */
type Assignable<Projection extends Shape, Shape> = [
  Exclude<keyof Shape, keyof Projection>
] extends [never]
  ? true
  : Exclude<keyof Shape, keyof Projection>;

/** The element type of a query that returns an array. */
type Row<T extends readonly unknown[]> = T[number];

// ── Public money ────────────────────────────────────────────────────────────

type _Grant = Expect<Assignable<Row<FunctionReturnType<typeof api.grants.list>>, Grant>>;
// `getById` shares `publicGrantFields` with `list`, so it is the same shape --
// asserted separately because "shares a helper" is a fact about today's code.
type _GrantById = Expect<Assignable<NonNullable<FunctionReturnType<typeof api.grants.getById>>, Grant>>;
type _Expense = Expect<Assignable<Row<FunctionReturnType<typeof api.expenses.list>>, Expense>>;
type _IncomeDeposit = Expect<Assignable<Row<FunctionReturnType<typeof api.income.list>>, IncomeDeposit>>;
type _Sponsor = Expect<Assignable<Row<FunctionReturnType<typeof api.sponsors.list>>, Sponsor>>;
type _WishlistItem = Expect<Assignable<Row<FunctionReturnType<typeof api.wishlist.list>>, WishlistItem>>;
type _TeamInfoField = Expect<Assignable<Row<FunctionReturnType<typeof api.teamInfo.list>>, TeamInfoField>>;
type _HcbCategoryRow = Expect<
  Assignable<Row<FunctionReturnType<typeof api.hcbCategories.list>>, HcbCategoryRow>
>;
type _Season = Expect<Assignable<Row<FunctionReturnType<typeof api.seasons.list>>, Season>>;
type _Donor = Expect<Assignable<Row<FunctionReturnType<typeof api.donors.list>>, Donor>>;

// ── Gated ───────────────────────────────────────────────────────────────────

type _Contact = Expect<Assignable<Row<FunctionReturnType<typeof api.contacts.list>>, Contact>>;
type _User = Expect<Assignable<Row<FunctionReturnType<typeof api.users.listUsers>>, User>>;
type _UserRequest = Expect<Assignable<Row<FunctionReturnType<typeof api.users.listRequests>>, User>>;
// `me` answers without a session, so it is the one that can be null.
type _Me = Expect<Assignable<NonNullable<FunctionReturnType<typeof api.users.me>>, User>>;
type _AuditLog = Expect<Assignable<Row<FunctionReturnType<typeof api.audit.list>>, AuditLog>>;

// ── The finance modules ─────────────────────────────────────────────────────
//
// `buildLedger` and `computeBalances` are handed the store's arrays directly,
// so `Expense` and `IncomeDeposit` have to satisfy the finance modules' own
// input shapes as well as the wire's. This is where a `season` or
// `depositAccount` that drifted to optional surfaces, rather than in a silent
// behaviour change deep inside the dedup -- and the `Omit` that used to stand
// on the deposit assertion took that guarantee straight back out again,
// exempting the one field the sentence names. It is gone: `income.list`
// throws on a missing account rather than emitting `undefined`, so
// `IncomeDeposit.depositAccount` is required and the assertion is whole. What
// makes that throw unreachable is `income.add`/`update` checking the account
// row exists before storing the reference -- not, as this comment previously
// claimed, the absence of a delete mutation for `accounts`. `seed.importAll`
// deletes every one of them.
//
// These are the assertions that constrain an interface from *outside*
// `types.ts` -- see the header. `BalanceExpense` earns its place even though
// it passes today for exactly that reason: `_Expense` above defends
// `reimbursedAt` only while `types.ts` still declares it, and loosening the
// interface and the projection together would fire nothing. `balances.ts`
// owns the requirement because `balances.ts` is the module the earlier
// `purchasedAt`/`reimbursedAt` loss actually broke.
import type { LedgerDeposit, LedgerExpense } from '$lib/finance/ledger';
import type { AccountConfig, BalanceDeposit, BalanceExpense } from '$lib/finance/balances';

type _LedgerExpense = Expect<Assignable<Expense, LedgerExpense>>;
type _LedgerDeposit = Expect<Assignable<IncomeDeposit, LedgerDeposit>>;

type _BalanceExpense = Expect<Assignable<Expense, BalanceExpense>>;
type _BalanceDeposit = Expect<Assignable<IncomeDeposit, BalanceDeposit>>;
// `computeBalances` reads `openingBalance` and `asOfDate` straight off
// `api.accounts.list`, which had no assertion at all -- so a projection that
// stopped emitting either would have silently rebased every balance to zero
// on an epoch cutoff.
type _AccountConfig = Expect<
  Assignable<Row<FunctionReturnType<typeof api.accounts.list>>, AccountConfig>
>;
