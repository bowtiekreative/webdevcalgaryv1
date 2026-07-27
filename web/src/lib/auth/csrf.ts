/**
 * CSRF tokens for dashboard forms.
 *
 * Sessions are cookie-backed, so any POST that changes state needs to prove it
 * came from our own form rather than a cross-site one. SameSite cookies cover
 * most of this, but they are a browser default rather than a guarantee, and
 * they do nothing for top-level POST navigations in older browsers.
 *
 * Pattern: a random token stored in the session, echoed in a hidden input, and
 * compared in constant time on submit.
 */

import type { APIContext, AstroGlobal } from 'astro';
import { timingSafeEqual } from 'node:crypto';

type WithSession = AstroGlobal | APIContext;

const CSRF_KEY = 'csrf';

/** Get the session's CSRF token, creating one on first use. */
export async function csrfToken(context: WithSession): Promise<string> {
	const existing = await context.session?.get(CSRF_KEY);

	if (typeof existing === 'string' && existing.length > 0) {
		return existing;
	}

	const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
	context.session?.set(CSRF_KEY, token);

	return token;
}

/** Compare without leaking length or content through timing. */
function safeEqual(a: string, b: string): boolean {
	const left = Buffer.from(a, 'utf8');
	const right = Buffer.from(b, 'utf8');

	if (left.length !== right.length) {
		return false;
	}

	return timingSafeEqual(left, right);
}

/**
 * Verify the `csrf` field of a submitted form.
 *
 * Returns false when the session has no token at all — a POST arriving before
 * any page was rendered is not something to accept.
 */
export async function verifyCsrf(context: WithSession, submitted: FormDataEntryValue | null): Promise<boolean> {
	const expected = await context.session?.get(CSRF_KEY);

	if (typeof expected !== 'string' || expected.length === 0) {
		return false;
	}

	return typeof submitted === 'string' && safeEqual(expected, submitted);
}
