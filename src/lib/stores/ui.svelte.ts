import type { Grant, GrantStatus } from '$lib/types';

/**
 * Modal and drawer state shared across routes.
 *
 * This used to be local `$state` inside the single `+page.svelte`. Splitting
 * the views into real routes left the grant drawer straddling `/grants` and
 * `/grants/table`, and the profile and access modals straddling every route,
 * so the state that outlives a single view moved here.
 */
class UiState {
  selectedGrant = $state<Grant | null>(null);
  isGrantDrawerOpen = $state(false);
  isAddGrantModalOpen = $state(false);
  initialAddStatus = $state<GrantStatus>('drafting');
  isProfileModalOpen = $state(false);
  isRequestAccessModalOpen = $state(false);

  openGrant(grant: Grant) {
    this.selectedGrant = grant;
    this.isGrantDrawerOpen = true;
  }

  closeGrant() {
    this.isGrantDrawerOpen = false;
    this.selectedGrant = null;
  }

  openAddGrant(status: GrantStatus = 'drafting') {
    this.initialAddStatus = status;
    this.isAddGrantModalOpen = true;
  }
}

export const ui = new UiState();
