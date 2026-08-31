import { browser } from '$app/environment';

const STORAGE_KEY = 'cacao_theme_v1';

export type ThemePreference = 'system' | 'light' | 'dark';

/**
 * Theme preference, persisted to localStorage and mirrored onto
 * `<html data-theme>`. 'system' clears the attribute so the
 * prefers-color-scheme block in app.css takes over.
 *
 * The initial value is read back off the document, which app.html has already
 * stamped before first paint — that keeps the toggle from flashing on load.
 */
class ThemeStore {
  preference = $state<ThemePreference>('system');

  constructor() {
    if (!browser) return;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      this.preference = stored;
    }
  }

  /** The theme actually being rendered, resolving 'system' against the OS. */
  get resolved(): 'light' | 'dark' {
    if (this.preference !== 'system') return this.preference;
    if (!browser) return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  set(preference: ThemePreference) {
    this.preference = preference;
    if (!browser) return;

    if (preference === 'system') {
      document.documentElement.removeAttribute('data-theme');
      localStorage.removeItem(STORAGE_KEY);
    } else {
      document.documentElement.setAttribute('data-theme', preference);
      localStorage.setItem(STORAGE_KEY, preference);
    }
  }

  toggle() {
    this.set(this.resolved === 'dark' ? 'light' : 'dark');
  }
}

export const theme = new ThemeStore();
