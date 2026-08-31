import type { Grant, GrantStatus } from '$lib/types';
import { cacao } from './cacaoStore.svelte';

/**
 * Modal and drawer state shared across routes.
 *
 * This used to be local `$state` inside the single `+page.svelte`. The grant
 * drawer straddles the Board and Table views on `/grants`, and the profile
 * and access modals straddle every route, so the state that outlives a
 * single view lives here.
 */
class UiState {
  selectedGrant = $state<Grant | null>(null);
  isGrantDrawerOpen = $state(false);
  isAddGrantModalOpen = $state(false);
  initialAddStatus = $state<GrantStatus>('drafting');
  isProfileModalOpen = $state(false);

  openGrant(grant: Grant) {
    if (cacao.currentUser.role === 'viewer') return;
    this.selectedGrant = grant;
    this.isGrantDrawerOpen = true;
  }

  closeGrant() {
    this.isGrantDrawerOpen = false;
    this.selectedGrant = null;
  }

  openAddGrant(status: GrantStatus = 'drafting') {
    if (cacao.currentUser.role === 'viewer') return;
    this.initialAddStatus = status;
    this.isAddGrantModalOpen = true;
  }
}

export const ui = new UiState();
