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
import type { NavItem } from '@frc2064/ui';
import { cacao } from '$lib/stores/cacaoStore.svelte';

interface NavSource {
  href: string;
  label: string;
  icon: ComponentType;
  /** Which pending count, if any, rides as a badge on this item. */
  badge?: 'expenses';
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavSource[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/grants', label: 'Grants', icon: LayoutGrid },
  { href: '/money', label: 'Money', icon: Wallet, badge: 'expenses' },
  { href: '/sponsors', label: 'Sponsors', icon: Handshake },
  { href: '/team', label: 'Team', icon: Users },
  { href: '/admin', label: 'Admin', icon: ShieldCheck, adminOnly: true }
];

export function visibleNavItems(isAdmin: boolean): NavSource[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);
}

/**
 * The finished list the shell renders: admin-only entries filtered out for
 * everyone else, and each badge resolved from a key to a live count.
 *
 * The library's NavItem carries a number because what a badge counts is this
 * app's business, not the design system's.
 */
export function navItems(): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || cacao.currentUser.role === 'admin').map(
    ({ href, label, icon, badge }) => ({
      href,
      label,
      icon,
      badge: badge === 'expenses' ? cacao.metrics.pendingExpensesCount : undefined
    })
  );
}
