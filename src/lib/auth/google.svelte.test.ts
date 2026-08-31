import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * These tests exist to pin the four properties this module is security code
 * for: the secret leaves the address bar, a dead session is dropped, a
 * *transient* failure is not mistaken for a dead session, and signing out
 * reaches the server before the browser forgets what to tell it.
 *
 * The module is imported fresh in every test (`vi.resetModules()`) because it
 * reads `PUBLIC_CONVEX_URL` and its `authState` rune once, at import.
 */

/** What the stubbed `$env/dynamic/public` in `vitest.config.ts` hands back. */
const CONVEX_SITE = 'https://test-deployment.convex.site';
const SESSION_KEY = 'cacao_session_v1';

let stored: Record<string, string>;
let location: { hash: string; pathname: string; search: string; href: string; reload: () => void };
/** `storage` listeners the module under test registered on `window`. */
let storageListeners: Array<(event: { key: string | null; newValue: string | null }) => void>;
let reloads: number;

/** A `localStorage`/`window`/`history` triple close enough to a browser's. */
function installBrowser(url = 'https://cacao.test/') {
	stored = {};
	storageListeners = [];
	reloads = 0;
	const parsed = new URL(url);
	location = {
		hash: parsed.hash,
		pathname: parsed.pathname,
		search: parsed.search,
		href: url,
		reload: () => {
			reloads += 1;
		}
	};

	const storage = {
		getItem: (key: string) => (key in stored ? stored[key] : null),
		setItem: (key: string, value: string) => {
			stored[key] = String(value);
		},
		removeItem: (key: string) => {
			delete stored[key];
		}
	};

	// The real `replaceState` rewrites the address bar, which is the thing
	// under test -- a stub that only records the call would let a secret stay
	// visible in `window.location` and still pass.
	const history = {
		replaceState: (_state: unknown, _title: string, url: string) => {
			const next = new URL(url, 'https://cacao.test');
			location.pathname = next.pathname;
			location.search = next.search;
			location.hash = next.hash;
			location.href = next.toString();
		}
	};

	vi.stubGlobal('localStorage', storage);
	vi.stubGlobal('history', history);
	vi.stubGlobal('window', {
		location,
		localStorage: storage,
		history,
		addEventListener: (
			type: string,
			handler: (event: { key: string | null; newValue: string | null }) => void
		) => {
			if (type === 'storage') storageListeners.push(handler);
		}
	});
}

/**
 * What the browser does in *this* tab when another tab of the same origin
 * writes to `localStorage`. The event never fires in the tab that wrote, which
 * is the whole reason a listener is the fix.
 */
function storageEventFromAnotherTab(key: string | null, newValue: string | null) {
	if (key === null) {
		stored = {};
	} else if (newValue === null) {
		delete stored[key];
	} else {
		stored[key] = newValue;
	}
	for (const handler of storageListeners) handler({ key, newValue });
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

beforeEach(() => {
	vi.resetModules();
	installBrowser();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('signIn', () => {
	it('hands off to the server and never builds the Google URL itself', async () => {
		const { signIn } = await import('./google.svelte');
		signIn();

		expect(location.href).toBe(`${CONVEX_SITE}/auth/start`);
		// The whole security argument for `/auth/start` is that the server owns
		// both the CSRF `state` and the session secret. A client that talked to
		// Google directly, or minted anything, would have to own one of them.
		expect(location.href).not.toContain('accounts.google.com');
		expect(stored).toEqual({});
	});
});

describe('captureSessionFromRedirect', () => {
	it('stores the fragment secret and scrubs it from the address bar', async () => {
		installBrowser('https://cacao.test/?ref=email#session=deadbeef');
		const { captureSessionFromRedirect, authState } = await import('./google.svelte');

		captureSessionFromRedirect();

		expect(stored[SESSION_KEY]).toBe('deadbeef');
		expect(authState.isSignedIn).toBe(true);
		expect(authState.loading).toBe(false);
		// The credential must not survive anywhere a user can copy it out of.
		expect(window.location.hash).toBe('');
		expect(window.location.href).not.toContain('session=');
		expect(window.location.href).not.toContain('deadbeef');
		// The rest of the URL is untouched.
		expect(window.location.search).toBe('?ref=email');
	});

	it('leaves an unrelated fragment alone', async () => {
		installBrowser('https://cacao.test/grants#open-drawer');
		const { captureSessionFromRedirect, authState } = await import('./google.svelte');

		captureSessionFromRedirect();

		expect(stored[SESSION_KEY]).toBeUndefined();
		expect(window.location.hash).toBe('#open-drawer');
		expect(authState.isSignedIn).toBe(false);
	});

	it('reports a session that was already stored on an earlier visit', async () => {
		const { captureSessionFromRedirect, authState } = await import('./google.svelte');
		stored[SESSION_KEY] = 'earlier-secret';

		captureSessionFromRedirect();

		expect(authState.isSignedIn).toBe(true);
	});
});

describe('fetchConvexToken', () => {
	it('exchanges the stored secret for an ID token', async () => {
		const fetchMock = vi.fn(async () => jsonResponse(200, { token: 'id-token' }));
		vi.stubGlobal('fetch', fetchMock);

		const { fetchConvexToken } = await import('./google.svelte');
		stored[SESSION_KEY] = 'live-secret';

		await expect(fetchConvexToken({ forceRefreshToken: false })).resolves.toBe('id-token');

		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe(`${CONVEX_SITE}/auth/refresh`);
		expect(JSON.parse(String(init.body))).toEqual({ secret: 'live-secret' });
	});

	it('drops the secret on 401, because that session is gone', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('Unknown session', { status: 401 })));

		const { fetchConvexToken, authState } = await import('./google.svelte');
		stored[SESSION_KEY] = 'revoked-secret';

		await expect(fetchConvexToken({ forceRefreshToken: false })).resolves.toBeNull();
		expect(stored[SESSION_KEY]).toBeUndefined();
		expect(authState.isSignedIn).toBe(false);
	});

	it('keeps the secret on 503, because that is Google having a bad minute', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('Refresh temporarily unavailable', { status: 503 }))
		);

		const { fetchConvexToken } = await import('./google.svelte');
		stored[SESSION_KEY] = 'live-secret';

		await expect(fetchConvexToken({ forceRefreshToken: false })).resolves.toBeNull();
		// Signing every user out over a transient upstream failure is the bug
		// this asserts against.
		expect(stored[SESSION_KEY]).toBe('live-secret');
	});

	it('keeps the secret when the network is unreachable', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('Failed to fetch');
			})
		);

		const { fetchConvexToken } = await import('./google.svelte');
		stored[SESSION_KEY] = 'live-secret';

		await expect(fetchConvexToken({ forceRefreshToken: false })).resolves.toBeNull();
		expect(stored[SESSION_KEY]).toBe('live-secret');
	});

	it('asks for nothing when no secret is stored', async () => {
		const fetchMock = vi.fn(async () => jsonResponse(200, { token: 'id-token' }));
		vi.stubGlobal('fetch', fetchMock);

		const { fetchConvexToken } = await import('./google.svelte');

		await expect(fetchConvexToken({ forceRefreshToken: false })).resolves.toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('signOut', () => {
	it('tells the server before it forgets the secret, then clears it', async () => {
		let secretAtRequestTime: string | null = null;
		const fetchMock = vi.fn(async () => {
			// Clearing `localStorage` first would leave the server holding a live
			// Google refresh token for the rest of the session's 30 days.
			secretAtRequestTime = stored[SESSION_KEY] ?? null;
			return new Response(null, { status: 204 });
		});
		vi.stubGlobal('fetch', fetchMock);

		const { signOut, authState } = await import('./google.svelte');
		stored[SESSION_KEY] = 'live-secret';

		await signOut();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe(`${CONVEX_SITE}/auth/signout`);
		expect(init.method).toBe('POST');
		expect(JSON.parse(String(init.body))).toEqual({ secret: 'live-secret' });
		expect(secretAtRequestTime).toBe('live-secret');

		expect(stored[SESSION_KEY]).toBeUndefined();
		expect(authState.isSignedIn).toBe(false);
	});

	it('still clears the secret when the server call fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('Failed to fetch');
			})
		);

		const { signOut } = await import('./google.svelte');
		stored[SESSION_KEY] = 'live-secret';

		await signOut();

		expect(stored[SESSION_KEY]).toBeUndefined();
	});
});

/**
 * Signing out has to end the session in every tab, not just the one the button
 * was in.
 *
 * `signOut`'s reload drops the ID token `ConvexClient` caches and offers no way
 * to clear -- but only for the tab that ran it. Shared build-room laptop, two
 * tabs: a student signs out in tab A and walks away, and tab B still reports
 * signed in and still holds a valid token, so the next person reads the gated
 * contact list and writes as the previous student until it expires.
 */
describe('watchSessionAcrossTabs', () => {
	it('tears this tab down when another one removes the session key', async () => {
		const { captureSessionFromRedirect, watchSessionAcrossTabs, authState } =
			await import('./google.svelte');
		stored[SESSION_KEY] = 'live-secret';
		captureSessionFromRedirect();
		watchSessionAcrossTabs();
		expect(authState.isSignedIn).toBe(true);

		storageEventFromAnotherTab(SESSION_KEY, null);

		expect(authState.isSignedIn).toBe(false);
		// The reload is the part that matters: local state alone leaves this
		// tab's ConvexClient holding a usable token for up to an hour.
		expect(reloads).toBe(1);
	});

	it('treats a localStorage.clear() as a sign-out too', async () => {
		const { captureSessionFromRedirect, watchSessionAcrossTabs, authState } =
			await import('./google.svelte');
		stored[SESSION_KEY] = 'live-secret';
		captureSessionFromRedirect();
		watchSessionAcrossTabs();

		// A `clear()` reports `key: null` rather than naming what it removed.
		storageEventFromAnotherTab(null, null);

		expect(authState.isSignedIn).toBe(false);
		expect(reloads).toBe(1);
	});

	it('ignores another key changing', async () => {
		const { captureSessionFromRedirect, watchSessionAcrossTabs, authState } =
			await import('./google.svelte');
		stored[SESSION_KEY] = 'live-secret';
		captureSessionFromRedirect();
		watchSessionAcrossTabs();

		storageEventFromAnotherTab('cacao_expenses_v2', '[]');

		expect(authState.isSignedIn).toBe(true);
		expect(reloads).toBe(0);
	});

	it('does not reload a tab that was never signed in', async () => {
		const { captureSessionFromRedirect, watchSessionAcrossTabs, authState } =
			await import('./google.svelte');
		captureSessionFromRedirect();
		watchSessionAcrossTabs();
		expect(authState.isSignedIn).toBe(false);

		// Somebody else's tab signing out must not bounce a public reader.
		storageEventFromAnotherTab(SESSION_KEY, null);

		expect(reloads).toBe(0);
	});
});
