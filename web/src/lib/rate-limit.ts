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
 * Caller's IP.
 *
 * Behind Coolify's Traefik the socket address is the proxy, so the forwarded
 * header is the only useful value. It is spoofable in principle — but a
 * spoofer is only splitting their own budget across more keys, which is a
 * strictly worse attack than not spoofing.
 */
export function clientKey(request: Request, fallback: string | undefined): string {
	const forwarded = request.headers.get('x-forwarded-for');

	return forwarded?.split(',')[0]?.trim() || fallback || 'unknown';
}
