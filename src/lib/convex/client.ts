import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { ConvexClient } from 'convex/browser';

/**
 * Read through `$env/dynamic/public` rather than `$env/static/public` so an
 * unset variable is a runtime condition instead of a build failure. A build
 * without one still deploys; it just has nothing to serve, which is what the
 * "not configured for this deployment" state on `/` says.
 */
export const convexUrl = env.PUBLIC_CONVEX_URL ?? '';

export const isConvexEnabled = convexUrl.length > 0;

let client: ConvexClient | null = null;

/** The shared client, or null during SSR and when no deployment is configured. */
export function getConvexClient(): ConvexClient | null {
	if (!browser || !isConvexEnabled) return null;
	client ??= new ConvexClient(convexUrl);
	return client;
}
