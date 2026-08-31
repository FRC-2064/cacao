import type { AuthConfig } from "convex/server";

declare const process: { env: Record<string, string | undefined> };

/**
 * Google issues the ID tokens; Convex verifies them against Google's JWKS,
 * which it discovers from `${domain}/.well-known/openid-configuration` --
 * Google's certs live at googleapis.com, not under the issuer host.
 *
 * `aud` on a Google ID token is the OAuth client ID, so that is `applicationID`.
 */
export default {
  providers: [
    {
      domain: "https://accounts.google.com",
      applicationID: process.env.GOOGLE_CLIENT_ID!,
    },
  ],
} satisfies AuthConfig;
