import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';

/**
 * Sign-in against Google's OIDC endpoints, asking for the `openid` scope and
 * nothing else.
 *
 * The ID token that comes back carries `iss`, `azp`, `aud`, `sub`, `at_hash`,
 * `iat` and `exp` -- no email, no name, no picture. That is the whole point of
 * this module: the app cannot leak student PII it was never handed. **Do not
 * add a scope.**
 *
 * The client here is deliberately thin. It never generates a secret and never
 * builds the Google authorize URL; `convex/http.ts` owns both. An earlier
 * draft had the browser mint one value that served as both the CSRF `state`
 * and the session secret, which is an account-takeover path: an attacker picks
 * S, walks a victim through Google's real consent screen, and the callback
 * mints a session for the *victim's* identity that the attacker's known S
 * unlocks. `state` and the session secret are separate server-minted values
 * and must stay that way.
 */

/** Where the session secret lives between page loads. Matches the store's `cacao_*_v1` keys. */
const SESSION_KEY = 'cacao_session_v1';

/**
 * HTTP actions are served from the deployment's `.convex.site` origin, while
 * `PUBLIC_CONVEX_URL` names its `.convex.cloud` websocket origin. Read through
 * `$env/dynamic/public` so a missing variable is a runtime condition rather
 * than a build failure.
 */
const convexSite = (env.PUBLIC_CONVEX_URL ?? '').replace('.convex.cloud', '.convex.site');

/** False when no deployment is configured to authenticate against. */
export const isAuthEnabled = convexSite.length > 0;

/** Reactive snapshot of the browser's session, for components to read. */
export const authState = $state({
	/** True until we have looked for a stored secret. */
	loading: true,
	isSignedIn: false
});

/**
 * `localStorage` throws rather than returning null when a browser is set to
 * block site data, and an exception here would take the whole app down on
 * load. A blocked store means "no session", which is a survivable answer.
 */
function readSecret(): string | null {
	if (!browser) return null;
	try {
		return localStorage.getItem(SESSION_KEY);
	} catch {
		return null;
	}
}

function writeSecret(secret: string): void {
	try {
		localStorage.setItem(SESSION_KEY, secret);
	} catch {
		// Session lasts this page load only; better than failing to sign in.
	}
}

function clearSecret(): void {
	try {
		localStorage.removeItem(SESSION_KEY);
	} catch {
		// Nothing was stored to begin with.
	}
}

/**
 * Hand off to `GET /auth/start`, which mints the CSRF `state`, binds it to
 * this browser with an HttpOnly cookie, and redirects on to Google. The client
 * holds no secret at this point -- one is issued only after Google has
 * verified who this is.
 */
export function signIn(): void {
	if (!browser || !isAuthEnabled) return;
	window.location.href = `${convexSite}/auth/start`;
}

/**
 * Collect the session secret `GET /auth/google/callback` left in the URL
 * fragment, then scrub it from the address bar and history.
 *
 * It travels in the fragment because a fragment never leaves the browser on a
 * navigation: this 30-day credential stays out of Google's referrer logs,
 * synced browser history, and Convex's own request log. Scrubbing keeps it out
 * of anything the user copies out of the address bar. Call this before the
 * first `setAuth`, so a browser returning from Google is already holding its
 * secret when Convex first asks for a token.
 */
export function captureSessionFromRedirect(): void {
	if (!browser) return;

	// Only rewrite the URL when we actually found a session -- other fragments
	// are somebody else's anchor.
	const hash = window.location.hash;
	if (hash) {
		const secret = new URLSearchParams(hash.slice(1)).get('session');
		if (secret) {
			writeSecret(secret);
			history.replaceState(null, '', window.location.pathname + window.location.search);
		}
	}

	authState.isSignedIn = readSecret() !== null;
	authState.loading = false;
}

/**
 * End the session on both sides.
 *
 * The `POST /auth/signout` comes first and is awaited: clearing
 * `localStorage` alone would strand a live Google refresh token on the server
 * for the remaining 30 days of the session's life. The reload afterwards is
 * load-bearing too -- `ConvexClient` caches the ID token it last fetched and
 * exposes no way to clear it, so only a fresh page drops it.
 */
export async function signOut(): Promise<void> {
	const secret = readSecret();

	if (secret && isAuthEnabled) {
		await fetch(`${convexSite}/auth/signout`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ secret }),
			// A sign-out that hangs on an unreachable server is a sign-out that
			// never happens, which is the wrong answer on a shared computer.
			signal: AbortSignal.timeout(5000)
		}).catch(() => {});
	}

	clearSecret();
	authState.isSignedIn = false;
	if (browser) window.location.href = '/';
}

/**
 * Tear this tab down when another one signs out.
 *
 * `signOut` reloads, and the comment on it reasons about exactly the hazard
 * that makes the reload necessary -- `ConvexClient` caches the last ID token it
 * fetched and offers no way to clear it. But a reload only fixes the tab that
 * initiated. Nothing crossed tabs at all: no `storage` listener, no
 * `visibilitychange` hook, no `BroadcastChannel` anywhere in `src/`.
 *
 * Shared build-room laptop, two tabs. A student signs out in tab A and walks
 * away. Tab B still reports signed in, and its `ConvexClient` still holds a
 * valid Google ID token, so the next person reads the gated contact list and
 * writes as the previous student until it expires -- up to an hour.
 *
 * A `storage` event fires only in the *other* tabs of an origin, which is
 * exactly the set that needs telling. `event.key === null` is a
 * `localStorage.clear()`, which takes the session with it and so counts.
 *
 * Deliberately one-directional: it reacts to the secret going away, never to
 * one arriving. Reloading a tab because a *different* tab signed in would
 * interrupt someone who is reading, and the session it would pick up is the
 * one that browser was already entitled to.
 */
export function watchSessionAcrossTabs(): void {
	if (!browser || typeof window.addEventListener !== 'function') return;

	window.addEventListener('storage', (event) => {
		if (event.key !== null && event.key !== SESSION_KEY) return;
		// Re-read rather than trusting `event.newValue`: a `clear()` reports null
		// for a key it may not have held, and the store is the fact.
		if (readSecret() !== null) return;
		// Only a tab that thought it had a session has anything to tear down --
		// without this, a signed-out tab reloads every time anyone signs out.
		if (!authState.isSignedIn) return;

		authState.isSignedIn = false;
		// A reload, for the same reason `signOut` reloads: dropping the cached
		// ID token is the only thing that actually ends this tab's access.
		window.location.reload();
	});
}

/**
 * A Google ID token for the current session, or null when there is none.
 *
 * Convex calls this as `fetchConvexToken({ forceRefreshToken })` and expects
 * to be able to force a fresh token when it sees an expired one.
 * `POST /auth/refresh` mints from Google on every call, so there is no cache
 * to skip and the argument needs no handling. **If anyone ever adds caching
 * here, `forceRefreshToken` has to start bypassing it** -- Convex will
 * otherwise loop, re-asking for a token it has already rejected.
 */
export async function fetchConvexToken(_args?: {
	forceRefreshToken: boolean;
}): Promise<string | null> {
	if (!browser || !isAuthEnabled) return null;
	const secret = readSecret();
	if (!secret) return null;

	let res: Response;
	try {
		res = await fetch(`${convexSite}/auth/refresh`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ secret })
		});
	} catch {
		// The network is down, not the session. Keep the secret.
		return null;
	}

	// 401 is the only status that means this session is dead -- the server has
	// already decided the grant is unrecoverable and deleted the row. Every
	// other failure (503 for a Google blip, 502 for a malformed refresh
	// response) is transient, and discarding the secret there would sign
	// everyone out over an upstream hiccup they would never notice otherwise.
	if (res.status === 401) {
		clearSecret();
		authState.isSignedIn = false;
		return null;
	}
	if (!res.ok) return null;

	const body = (await res.json()) as unknown as { token?: unknown };
	return typeof body.token === 'string' ? body.token : null;
}
