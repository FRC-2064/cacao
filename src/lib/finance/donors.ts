/**
 * Donor aggregation: who gave us what, in a given calendar year.
 *
 * Gifts reach the team by three unrelated routes -- an online donation through
 * Hack Club Bank, a physical check logged as a deposit, and an in-kind gift
 * where someone bought something and waived reimbursement. Nothing links them
 * but the donor's name, so name is the join key and consolidating spellings is
 * most of the work here.
 *
 * Everything is derived from `buildLedger` output rather than from the raw
 * tables. That is deliberate: the ledger has already collapsed the overlap
 * between a hand-logged record and the bank transaction that paid it, so a
 * check entered by hand *and* synced from HCB is one gift here, not two.
 */

import type { LedgerEntry } from './ledger';

/** The single bucket every anonymous gift rolls into. */
export const ANONYMOUS_KEY = 'anonymous';

/**
 * Re-exported, not reimplemented. `convex/donors.ts` resolves a donor name to
 * a row at write time and this module groups gifts by the same rule at read
 * time; two copies of a matching rule that drift do not raise an error, they
 * split one person's giving across two rows and halve their total in the
 * report. The single implementation lives in `convex/donorNames.ts`, which is
 * a dependency-free leaf precisely so both sides can reach it.
 */
import {
  ANONYMOUS_DONOR_NAME,
  isAnonymousDonor,
  isEmailShapedDonorName,
  normalizeDonorName,
  redactEmails
} from '../../../convex/donorNames';
export {
  ANONYMOUS_DONOR_NAME,
  isAnonymousDonor,
  isEmailShapedDonorName,
  normalizeDonorName,
  redactEmails
};

/**
 * The name a gift is attributed under, or `null` when there is none.
 *
 * An email address is not a name. `parseDonationMemo` takes everything after
 * "Donation from " as one, and the live HCB feed contains `"Donation from
 * A.Rivera0106@example.com"` -- so an address was rendered as a donor name in
 * the donor report and written into the CSV export, with the whole feed
 * cached in `localStorage` under `cacao_hcb_txns_v2`. Section 5's "donors are
 * public on HCB anyway" is a ruling about donor *names*; it does not reach an
 * address.
 *
 * Such a gift falls into the anonymous bucket rather than being dropped.
 * Dropping it would quietly take real money out of the donor totals, and the
 * bucket is already this app's answer to "a gift nobody can be named for".
 * Two of them merging there is not a mis-attribution: it is a bucket, not a
 * person, `suggestDuplicates` excludes it on both sides, and nothing is
 * produced per donor from it.
 *
 * Applied to every source, not just the memo. The deposit and in-kind paths
 * carry a name a human typed into a form, and a human can type an address
 * into a name box just as readily as a donor can.
 */
function attributableName(raw: string | null | undefined): string | null {
  const name = raw?.trim();
  if (!name) return null;
  return isEmailShapedDonorName(name) ? ANONYMOUS_DONOR_NAME : name;
}

/**
 * The donations endpoint is the reliable source for a donor name, but it can
 * be missing a row (a failed sync, a very recent gift). The memo carries the
 * same name in a fixed shape, so it serves as the fallback.
 */
export function parseDonationMemo(memo: string): string | null {
  const match = memo.match(/^\s*donation from\s+(.+?)\s*$/i);
  return match ? match[1] : null;
}

/** A donation as the HCB `/donations` endpoint reports it. */
export interface HcbDonationRef {
  transactionId: string;
  donorName: string;
  /** YYYY-MM-DD, the date the donor gave -- not the settlement date. */
  date: string;
}

export type GiftSource = 'hcb' | 'check' | 'in_kind';

export interface DonorGift {
  id: string;
  /** The raw spelling this gift carried, before normalization. */
  donorName: string;
  source: GiftSource;
  amount: number;
  date: string;
  taxYear: number;
  /**
   * The ledger entry's title, with any email address taken out. For an HCB
   * donation the title *is* the memo, and the donor report renders this line
   * directly under the donor name -- so sanitizing the name alone still put
   * "Donation from someone@example.com" on the screen and into the CSV.
   */
  description: string;
}

export interface DonorTotals {
  /** Normalized name, or ANONYMOUS_KEY. */
  key: string;
  displayName: string;
  gifts: DonorGift[];
  cashTotal: number;
  inKindTotal: number;
  total: number;
  isAnonymous: boolean;
}

function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

/**
 * Pull every attributable gift out of the ledger.
 *
 * The synthetic `in_kind_gifts` income entry that `buildLedger` emits for each
 * donated expense is skipped here: the spend-side entry is the one carrying
 * the donor name, and counting both would double every in-kind gift.
 */
export function collectGifts(input: {
  entries: LedgerEntry[];
  hcbDonations: HcbDonationRef[];
  taxYear: number | 'all';
}): DonorGift[] {
  const donationByTxn = new Map(input.hcbDonations.map((d) => [d.transactionId, d]));
  const gifts: DonorGift[] = [];

  for (const entry of input.entries) {
    let gift: DonorGift | null = null;

    if (
      entry.direction === 'in' &&
      entry.source === 'hcb' &&
      entry.hcbTransaction?.type === 'donation'
    ) {
      const ref = donationByTxn.get(entry.hcbTransaction.id);
      // Both sources are sanitized: the `/donations` endpoint reports
      // whatever the donor typed into the name box, exactly as the memo does.
      const name = attributableName(ref?.donorName ?? parseDonationMemo(entry.hcbTransaction.memo));
      if (name) {
        const date = ref?.date ?? entry.date;
        gift = {
          id: entry.id,
          donorName: name,
          source: 'hcb',
          amount: entry.amount,
          date,
          taxYear: yearOf(date),
          description: redactEmails(entry.title)
        };
      }
    } else if (entry.direction === 'in' && attributableName(entry.deposit?.donorName)) {
      const d = entry.deposit!;
      gift = {
        id: entry.id,
        donorName: attributableName(d.donorName)!,
        source: 'check',
        amount: entry.amount,
        date: entry.date,
        taxYear: d.taxYear ?? yearOf(entry.date),
        description: redactEmails(entry.title)
      };
    } else if (
      entry.direction === 'out' &&
      entry.expense?.status === 'donated' &&
      attributableName(entry.expense.donorName)
    ) {
      const e = entry.expense;
      gift = {
        id: entry.id,
        donorName: attributableName(e.donorName)!,
        source: 'in_kind',
        amount: entry.amount,
        date: entry.date,
        taxYear: e.taxYear ?? yearOf(entry.date),
        description: redactEmails(entry.title)
      };
    }

    if (!gift) continue;
    if (input.taxYear !== 'all' && gift.taxYear !== input.taxYear) continue;
    gifts.push(gift);
  }

  return gifts;
}

/** The spelling used most often wins; ties break toward the first seen. */
function pickDisplayName(gifts: DonorGift[]): string {
  const counts = new Map<string, number>();
  for (const g of gifts) counts.set(g.donorName, (counts.get(g.donorName) ?? 0) + 1);

  let best = gifts[0].donorName;
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

export function groupDonors(gifts: DonorGift[]): DonorTotals[] {
  const buckets = new Map<string, DonorGift[]>();

  for (const gift of gifts) {
    const anonymous = isAnonymousDonor(gift.donorName);
    const key = anonymous ? ANONYMOUS_KEY : normalizeDonorName(gift.donorName);
    if (!key) continue;
    const existing = buckets.get(key);
    if (existing) existing.push(gift);
    else buckets.set(key, [gift]);
  }

  const donors: DonorTotals[] = [];
  for (const [key, bucket] of buckets) {
    const isAnonymous = key === ANONYMOUS_KEY;
    const cashTotal = bucket
      .filter((g) => g.source !== 'in_kind')
      .reduce((sum, g) => sum + g.amount, 0);
    const inKindTotal = bucket
      .filter((g) => g.source === 'in_kind')
      .reduce((sum, g) => sum + g.amount, 0);

    donors.push({
      key,
      displayName: isAnonymous ? 'Anonymous' : pickDisplayName(bucket),
      gifts: [...bucket].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
      cashTotal,
      inKindTotal,
      total: cashTotal + inKindTotal,
      isAnonymous
    });
  }

  return donors.sort((a, b) => b.total - a.total);
}

/**
 * Above this, two names are offered as a possible duplicate. Tuned to catch a
 * single-character typo in a typical name while leaving two different people
 * alone. It only ever produces a suggestion for a human to accept, so erring
 * slightly loose is cheap and erring tight loses real merges.
 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.85;

export interface DuplicateSuggestion {
  keys: [string, string];
  displayNames: [string, string];
  similarity: number;
}

/** Standard iterative Levenshtein, two rows rather than a full matrix. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
}

/** 1 for identical, 0 for nothing in common. */
export function nameSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

/**
 * Near-identical donor names, offered for a human to accept. Never applied
 * automatically: a wrong merge silently combines two people's giving onto one
 * line, and the whole point of this view is that someone reads it before it
 * goes anywhere.
 *
 * The anonymous bucket is excluded on both sides -- it is a bucket, not a
 * person, and merging it into a named donor would be a real error.
 */
export function suggestDuplicates(
  donors: DonorTotals[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD
): DuplicateSuggestion[] {
  const named = donors.filter((d) => !d.isAnonymous && d.key !== ANONYMOUS_KEY);
  const suggestions: DuplicateSuggestion[] = [];

  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      const similarity = nameSimilarity(named[i].key, named[j].key);
      if (similarity < threshold) continue;
      suggestions.push({
        keys: [named[i].key, named[j].key],
        displayNames: [named[i].displayName, named[j].displayName],
        similarity
      });
    }
  }

  return suggestions.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Carried at the top of every export. The team hands this to a donor as a
 * reference for their own records, not as a receipt: HCB reports only what
 * landed in the account, so a processing fee can make this less than what the
 * donor was actually charged, and there is no gross figure in the API to use
 * instead.
 */
export const CSV_CAVEAT =
  'Amounts are what the team received. Processing fees may make this less than what you were charged - please check your own records.';

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const SOURCE_LABELS: Record<GiftSource, string> = {
  hcb: 'Hack Club Bank',
  check: 'Check',
  in_kind: 'In-kind'
};

const money = (n: number) => n.toFixed(2);

export function donorsToCsv(donors: DonorTotals[], period: string): string {
  const rows = [
    csvEscape(`Donor giving - ${period}. ${CSV_CAVEAT}`),
    'Donor,Gifts,Cash,In-kind,Total',
    ...donors.map((d) =>
      [
        csvEscape(d.displayName),
        String(d.gifts.length),
        money(d.cashTotal),
        money(d.inKindTotal),
        money(d.total)
      ].join(',')
    )
  ];
  return rows.join('\n') + '\n';
}

export function giftsToCsv(donor: DonorTotals, period: string): string {
  const rows = [
    csvEscape(`${donor.displayName} - giving for ${period}. ${CSV_CAVEAT}`),
    'Date,Source,Description,Amount',
    ...donor.gifts.map((g) =>
      [g.date, csvEscape(SOURCE_LABELS[g.source]), csvEscape(g.description), money(g.amount)].join(
        ','
      )
    ),
    `Total,,,${money(donor.total)}`
  ];
  return rows.join('\n') + '\n';
}
