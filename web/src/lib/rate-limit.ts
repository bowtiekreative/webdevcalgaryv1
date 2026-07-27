/**
 * Per-IP rate limiting for the public, unauthenticated endpoints.
 *
 * These endpoints have no session to protect, so CSRF tokens buy nothing. What
 * they do need protecting from is volume: the lead form writes to WordPress and
 * sends two emails, and the order endpoint calls PayPal and writes an order
 * record. Scripted, either one is a cheap way to fill the job queue with junk
 * or burn the Emailit send allowance.
 *
 * In-memory and per-process on purpose. A shared store would be the right
 * answer across several instances, but this runs as one container, and an
 * approximate limit that ships beats an exact one that needs Redis.
 */

interface Bucket {
	hits: number[];
}

const buckets = new Map<string, Bucket>();

/** Stop the map growing without bound on a long-lived server. */
function sweep(now: number, windowMs: number): void {
	if (buckets.size <= 5_000) {
		return;
	}

	for (const [key, bucket] of buckets) {
		if (bucket.hits.every((at) => now - at >= windowMs)) {
			buckets.delete(key);
		}
	}
}

export interface RateLimitOptions {
	/** Distinguishes endpoints so one does not consume another's budget. */
	name: string;
	limit: number;
	windowMs: number;
}

/**
 * Record a hit and say whether it should be refused.
 *
 * @returns true when the caller is over its budget.
 */
export function rateLimited(key: string, { name, limit, windowMs }: RateLimitOptions): boolean {
	const now = Date.now();
	const id = `${name}:${key}`;
	const recent = (buckets.get(id)?.hits ?? []).filter((at) => now - at < windowMs);

	recent.push(now);
	buckets.set(id, { hits: recent });
	sweep(now, windowMs);

	return recent.length > limit;
}

/**
 * Caller's IP, as seen through Cloudflare and then Traefik.
 *
 * Header order here is load-bearing, and getting it wrong silently disables
 * rate limiting rather than breaking anything visibly.
 *
 * This site is proxied by Cloudflare, so the connection Traefik sees comes from
 * a Cloudflare **edge** address — and Cloudflare answers from many edge IPs,
 * rotating between requests from the same visitor. Keying on
 * `X-Forwarded-For`'s first entry or on `clientAddress` therefore produces a
 * *different* key almost every request, every bucket holds one hit, and nothing
 * is ever limited. Verified against production: through Cloudflare the limit
 * never tripped; bypassing it with --resolve, the eleventh request 429'd.
 *
 * `CF-Connecting-IP` is Cloudflare's canonical real-client address and is
 * overwritten by them on every proxied request, so it cannot be forged by a
 * visitor coming through the CDN.
 *
 * A request sent straight to the origin IP can set it to anything. That is
 * worth knowing but not worth blocking here: the endpoints this guards are
 * public and unauthenticated, so the worst it buys is exhausting some other
 * address's share — and anyone willing to do that could just use more source
 * addresses instead.
 */
export function clientKey(request: Request, fallback: string | undefined): string {
	const headers = request.headers;

	const candidate =
		headers.get('cf-connecting-ip') ??
		headers.get('true-client-ip') ??
		headers.get('x-forwarded-for')?.split(',')[0];

	return candidate?.trim() || fallback || 'unknown';
}
