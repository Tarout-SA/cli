/**
 * Build a single-scheme app URL.
 *
 * `application.appSubdomain` is stored ALREADY prefixed with `https://` (see the
 * server's coolify-deployment-queue), so naively templating
 * `https://${appSubdomain}` produces an invalid `https://https://...`. Custom
 * `domain[].host` values, by contrast, are bare hosts. This helper is idempotent:
 * it returns already-prefixed values unchanged and prefixes bare hosts.
 */
export function formatAppUrl(host?: string | null): string | null {
	if (!host) return null;
	return /^https?:\/\//i.test(host) ? host : `https://${host}`;
}
