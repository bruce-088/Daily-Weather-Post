// Canonical OAuth origin — MUST match the redirect URI registered in
// each provider's developer console (LinkedIn, etc.).
//
// Why hardcoded: preview branches use rotating subdomains
// (id-preview--*.lovable.app) which cannot all be registered in
// LinkedIn's redirect URI allowlist. Forcing the canonical origin
// guarantees the redirect_uri sent to LinkedIn always matches.
export const CANONICAL_OAUTH_ORIGIN = "https://skybriefweather.com";

export const getLinkedInRedirectUri = () =>
  `${CANONICAL_OAUTH_ORIGIN}/linkedin/callback`;
