export const OAUTH_SESSION_COOKIE = "__Host-oa_oauth_session";
export const LEGACY_GITHUB_SESSION_COOKIE = "__Host-oa_github_session";
// Keep Feishu/GitHub login available for the requested seven-day return window.
// Server-side revocation, member status and provider configuration are still
// checked on every request, so extending the browser session does not bypass
// OA access control.
export const OAUTH_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
export const OAUTH_SESSION_IDLE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type OAuthProvider = "github" | "feishu";
