import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { hashSecret } from "./sessions";

const http = httpRouter();

/** Google's OIDC endpoints, from its discovery document. */
const AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** How long a session lives before the user must sign in again. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Carries the CSRF `state` from `/auth/start` to the callback. */
const STATE_COOKIE = "__Host-g_state";

/** Hex-encode `byteLength` bytes of CSPRNG output -- used for both the CSRF `state` and the session secret. */
function randomToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** 10 minutes is generous for a consent screen and short enough that a stale cookie is no risk. */
function setStateCookie(state: string): string {
  return `${STATE_COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`;
}
const CLEAR_STATE_COOKIE = `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

/**
 * `APP_URL`'s origin, validated once per request before any side effect.
 * Normalizing to `.origin` means a trailing slash or path on the env var
 * cannot produce a double slash in a redirect or a value that fails to match
 * the browser's `Origin` header in CORS. Checking this first means a
 * misconfigured deployment fails closed instead of writing a session it then
 * has no valid place to redirect the user back to.
 */
function appOrigin(): string | null {
  const appUrl = process.env.APP_URL;
  if (!appUrl) return null;
  try {
    return new URL(appUrl).origin;
  } catch {
    return null;
  }
}

/**
 * The `sub` and `iss` of an ID token, read without verifying the signature.
 *
 * Safe here and only here: the token has just come back over TLS from Google's
 * own token endpoint in response to a code we issued. Every other consumer of
 * this token -- Convex itself -- verifies it against Google's JWKS.
 */
function readIdToken(idToken: string): { iss: string; sub: string } {
  const [, payload] = idToken.split(".");
  const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  if (typeof json.iss !== "string" || typeof json.sub !== "string") {
    throw new Error("ID token is missing iss or sub");
  }
  return { iss: json.iss, sub: json.sub };
}

http.route({
  path: "/auth/start",
  method: "GET",
  handler: httpAction(async () => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!clientId || !siteUrl) return new Response("Server misconfigured", { status: 500 });

    // A random, single-use `state` binds whichever browser lands on the
    // callback to this browser: it never doubles as the session secret (see
    // the callback, which mints that separately).
    const state = randomToken(32);
    const authorizeUrl = new URL(AUTHORIZE_ENDPOINT);
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", `${siteUrl}/auth/google/callback`);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", "openid");
    authorizeUrl.searchParams.set("access_type", "offline");
    authorizeUrl.searchParams.set("prompt", "consent");
    authorizeUrl.searchParams.set("state", state);

    return new Response(null, {
      status: 302,
      headers: { Location: authorizeUrl.toString(), "Set-Cookie": setStateCookie(state) },
    });
  }),
});

http.route({
  path: "/auth/google/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const appUrl = appOrigin();
    if (!appUrl) return new Response("Server misconfigured", { status: 500 });
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!clientId || !clientSecret || !siteUrl) {
      return new Response("Server misconfigured", { status: 500 });
    }

    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");
    const cookieState = readCookie(request, STATE_COOKIE);

    // Every path below is the end of this flow -- clear the one-shot cookie
    // no matter how it comes out.
    const errorRedirect = () =>
      new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/?error=1`, "Set-Cookie": CLEAR_STATE_COOKIE },
      });

    // Google reports consent denial (or any other failure on its side) with
    // `error` and no `code`, never the other way around.
    if (oauthError || !code) return errorRedirect();

    // The browser that lands here must be the same one `/auth/start` sent to
    // Google: without this check, an attacker can plant their own `state`,
    // walk a victim through Google's consent screen using our real
    // client_id/redirect_uri, and then redeem that known `state` themselves
    // -- the callback would otherwise mint a session for the victim's
    // identity that the attacker's known secret unlocks.
    if (!state || !cookieState || state !== cookieState) {
      return new Response("Invalid state", {
        status: 400,
        headers: { "Set-Cookie": CLEAR_STATE_COOKIE },
      });
    }

    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${siteUrl}/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!res.ok) return errorRedirect();

    const tokens = (await res.json()) as unknown as {
      id_token?: unknown;
      refresh_token?: unknown;
    };
    if (typeof tokens.id_token !== "string" || typeof tokens.refresh_token !== "string") {
      return errorRedirect();
    }

    let identity: { iss: string; sub: string };
    try {
      identity = readIdToken(tokens.id_token);
    } catch {
      // Never surface anything derived from `idToken` here: a malformed
      // token makes `atob`/`JSON.parse` throw with a snippet of their input
      // embedded in the message, which would otherwise leak into the body.
      return new Response("Bad ID token", {
        status: 502,
        headers: { "Set-Cookie": CLEAR_STATE_COOKIE },
      });
    }

    // The session secret is freshly minted here, never the `state` value --
    // `state` only proved this request came from the browser `/auth/start`
    // sent out. It was a CSRF token, not meant to double as a bearer
    // credential.
    const sessionSecret = randomToken(32);
    await ctx.runMutation(internal.sessions.create, {
      secretHash: await hashSecret(sessionSecret),
      refreshToken: tokens.refresh_token,
      tokenIdentifier: `${identity.iss}|${identity.sub}`,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });

    // In the fragment, not the query string: fragments never leave the
    // browser on a navigation, so this 30-day credential never reaches
    // Google's referrer logs, synced browser history, or Convex's own
    // request log.
    return new Response(null, {
      status: 302,
      headers: { Location: `${appUrl}/#session=${sessionSecret}`, "Set-Cookie": CLEAR_STATE_COOKIE },
    });
  }),
});

/** The app runs on a different origin than `*.convex.site`, so its JSON POSTs (`/auth/refresh`, `/auth/signout`) need CORS, restricted to that one origin. */
function authCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": appOrigin() ?? "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

http.route({
  path: "/auth/refresh",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: authCorsHeaders() })),
});

http.route({
  path: "/auth/refresh",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const cors = authCorsHeaders();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response("Malformed JSON", { status: 400, headers: cors });
    }
    if (typeof body !== "object" || body === null) {
      return new Response("Missing secret", { status: 400, headers: cors });
    }
    const secret = (body as Record<string, unknown>).secret;
    if (typeof secret !== "string") {
      return new Response("Missing secret", { status: 400, headers: cors });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return new Response("Server misconfigured", { status: 500, headers: cors });
    }

    const session = await ctx.runQuery(internal.sessions.bySecretHash, {
      secretHash: await hashSecret(secret),
    });
    if (!session) return new Response("Unknown session", { status: 401, headers: cors });

    if (session.expiresAt < Date.now()) {
      await ctx.runMutation(internal.sessions.remove, { id: session._id });
      return new Response("Session expired", { status: 401, headers: cors });
    }

    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: session.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) {
      // The status alone does not tell us the grant is dead: Google returns
      // 401 for both a revoked refresh token (`invalid_grant`) *and* wrong
      // client credentials (`invalid_client`) -- and a rotated or mistyped
      // GOOGLE_CLIENT_SECRET must not delete every session it touches. Only
      // the body's `error` field decides; status just narrows which
      // statuses are worth parsing. Anything else (429, 5xx, or a 401/400
      // that isn't `invalid_grant`) is transient or a config problem, not a
      // dead session, so the row survives.
      let deadGrant = false;
      if (res.status === 401 || res.status === 400) {
        try {
          const errorBody = (await res.json()) as unknown as { error?: unknown };
          deadGrant = errorBody.error === "invalid_grant";
        } catch {
          // Non-JSON error body from Google: treat as transient, not a dead grant.
        }
      }
      if (deadGrant) {
        await ctx.runMutation(internal.sessions.remove, { id: session._id });
        return new Response("Refresh failed", { status: 401, headers: cors });
      }
      return new Response("Refresh temporarily unavailable", { status: 503, headers: cors });
    }

    const tokens = (await res.json()) as unknown as { id_token?: unknown };
    if (typeof tokens.id_token !== "string") {
      return new Response("Refresh response missing id_token", { status: 502, headers: cors });
    }

    return Response.json({ token: tokens.id_token }, { headers: cors });
  }),
});

http.route({
  path: "/auth/signout",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: authCorsHeaders() })),
});

/**
 * Revoke a session.
 *
 * **Deliberately unauthenticated -- do not add `requireActor` here.** Holding
 * the secret *is* the authorization: it is the same credential `/auth/refresh`
 * accepts, and it is hashed before it touches the database. Requiring a valid
 * Convex identity would break sign-out in exactly the case that matters most
 * -- a session whose ID token can no longer be minted (Google revoked the
 * grant, the client secret rotated, the network is down) would become
 * impossible to revoke, stranding a live refresh token for the remaining 30
 * days of the row's life.
 *
 * A well-formed request is always 204, whether or not a row was there. A
 * different status for "that session existed" would be an oracle telling
 * whoever holds a stolen secret whether it is still live.
 */
http.route({
  path: "/auth/signout",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const cors = authCorsHeaders();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response("Malformed JSON", { status: 400, headers: cors });
    }
    if (typeof body !== "object" || body === null) {
      return new Response("Missing secret", { status: 400, headers: cors });
    }
    const secret = (body as Record<string, unknown>).secret;
    if (typeof secret !== "string") {
      return new Response("Missing secret", { status: 400, headers: cors });
    }

    // No-ops when the row is already gone -- a retry from a browser that has
    // already signed out, or a secret the expiry sweep reaped, is not an error.
    await ctx.runMutation(internal.sessions.removeBySecretHash, {
      secretHash: await hashSecret(secret),
    });

    return new Response(null, { status: 204, headers: cors });
  }),
});

export default http;
