// lucide-svelte 0.475 still emits legacy class components, so these are
// ComponentType rather than Svelte 5's Component.
import type { ComponentType } from 'svelte';
import {
  LayoutDashboard,
  LayoutGrid,
  Wallet,
  Handshake,
  Users,
  ShieldCheck
} from 'lucide-svelte';
import { cacao } from '$lib/stores/cacaoStore.svelte';

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType;
  /** Which pending count, if any, rides as a badge on this item. */
  badge?: 'expenses';
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/grants', label: 'Grants', icon: LayoutGrid },
  { href: '/money', label: 'Money', icon: Wallet, badge: 'expenses' },
  { href: '/sponsors', label: 'Sponsors', icon: Handshake },
  { href: '/team', label: 'Team', icon: Users },
  { href: '/admin', label: 'Admin', icon: ShieldCheck, adminOnly: true }
];

export function visibleNavItems(isAdmin: boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);
}

/** Destinations for the mobile bottom bar: the same six/seven real destinations. */
export function primaryNavItems(isAdmin: boolean): NavItem[] {
  return visibleNavItems(isAdmin);
}

export function pendingFor(item: NavItem): number {
  if (item.badge === 'expenses') return cacao.metrics.pendingExpensesCount;
  return 0;
}

function normalise(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

/**
 * Exact match. Every nav destination is now a flat top-level route with no
 * sibling sub-routes (the former Board/Table and Expenses/Deposits/etc.
 * splits are in-page toggles, not routes), so there is no remaining need for
 * a separate prefix-matching variant.
 */
export function isActive(pathname: string, href: string): boolean {
  return normalise(pathname) === href;
}
