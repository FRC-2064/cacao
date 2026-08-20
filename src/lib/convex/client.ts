import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { ConvexClient } from 'convex/browser';

/**
 * Convex is opt-in via `PUBLIC_CONVEX_URL`. With it unset the app runs entirely
 * on localStorage against the seed dataset, which keeps `npm run dev` and the
 * production build working for anyone who has not provisioned a deployment yet.
 *
 * Read through `$env/dynamic/public` rather than `$env/static/public` so a
 * missing variable is a runtime fallback instead of a build failure.
 */
export const convexUrl = env.PUBLIC_CONVEX_URL ?? '';

export const isConvexEnabled = convexUrl.length > 0;

let client: ConvexClient | null = null;

/** The shared client, or null when running in local (seed) mode or during SSR. */
export function getConvexClient(): ConvexClient | null {
	if (!browser || !isConvexEnabled) return null;
	client ??= new ConvexClient(convexUrl);
	return client;
}
