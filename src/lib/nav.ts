// lucide-svelte 0.475 still emits legacy class components, so these are
// ComponentType rather than Svelte 5's Component.
import type { ComponentType } from 'svelte';
import {
  LayoutGrid,
  Table2,
  Receipt,
  Handshake,
  Contact,
  ChartNoAxesColumn,
  ShieldCheck
} from 'lucide-svelte';
import { cacao } from '$lib/stores/cacaoStore.svelte';

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType;
  /** Which pending count, if any, rides as a badge on this item. */
  badge?: 'requests' | 'expenses';
  adminOnly?: boolean;
  /**
   * Kanban and table are two renderings of the same data, not two
   * destinations. They stay in the wide top nav but are collapsed into a
   * view toggle on the /grants page, so the bottom bar keeps to the five or
   * six real destinations Material 3 allows.
   */
  secondary?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/grants', label: 'Grants', icon: LayoutGrid },
  { href: '/grants/table', label: 'Table', icon: Table2, secondary: true },
  { href: '/expenses', label: 'Expenses', icon: Receipt, badge: 'expenses' },
  { href: '/sponsors', label: 'Sponsors', icon: Handshake },
  { href: '/contacts', label: 'Contacts', icon: Contact },
  { href: '/analytics', label: 'Finances', icon: ChartNoAxesColumn },
  { href: '/admin', label: 'Admin', icon: ShieldCheck, badge: 'requests', adminOnly: true }
];

export function visibleNavItems(isAdmin: boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);
}

/** Destinations for the mobile bottom bar: everything but the view variants. */
export function primaryNavItems(isAdmin: boolean): NavItem[] {
  return visibleNavItems(isAdmin).filter((item) => !item.secondary);
}

export function pendingFor(item: NavItem): number {
  if (item.badge === 'requests') return cacao.metrics.pendingRequestsCount;
  if (item.badge === 'expenses') return cacao.metrics.pendingExpensesCount;
  return 0;
}

function normalise(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

/** Exact match — /grants must not light up while /grants/table is open. */
export function isActive(pathname: string, href: string): boolean {
  return normalise(pathname) === href;
}

/** Prefix match — the bottom bar's Grants tab covers /grants/table too. */
export function isSectionActive(pathname: string, href: string): boolean {
  const path = normalise(pathname);
  return path === href || path.startsWith(`${href}/`);
}
