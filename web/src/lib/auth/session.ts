/**
 * Session helpers.
 *
 * The session holds only the WordPress user id. Roles and subscription state
 * are re-read from WordPress on each request, so revoking a role or cancelling
 * a subscription takes effect immediately rather than whenever the session
 * happens to expire.
 *
 * That costs one HTTP call per dashboard request, which is the right trade for
 * a dashboard. If it ever matters, cache `getUser` behind a short TTL rather
 * than trusting the session copy.
 */

import type { APIContext, AstroGlobal } from 'astro';
import { getUser, type WpUser } from './wp';
import { ROLE_ADMIN } from '../../config';

/** Anything with a `.session`, i.e. an Astro page, endpoint or middleware. */
type WithSession = AstroGlobal | APIContext;

const USER_ID_KEY = 'userId';

export async function startSession(context: WithSession, user: WpUser): Promise<void> {
	// Rotate the session id on privilege change to prevent session fixation:
	// an attacker who planted a session id cannot ride it after login.
	// regenerate() is synchronous; set() must happen after it so the id lands
	// on the new session rather than the discarded one.
	context.session?.regenerate();
	context.session?.set(USER_ID_KEY, user.id);
}

export async function endSession(context: WithSession): Promise<void> {
	// Also synchronous, like regenerate().
	context.session?.destroy();
}

/**
 * The signed-in user, or null.
 *
 * Returns null (rather than throwing) when WordPress is unreachable, so an
 * outage logs people out instead of showing a 500 on every page.
 */
export async function currentUser(context: WithSession): Promise<WpUser | null> {
	const userId = await context.session?.get(USER_ID_KEY);

	if (typeof userId !== 'number') {
		return null;
	}

	try {
		return await getUser(userId);
	} catch {
		return null;
	}
}

export function isAdmin(user: WpUser | null): boolean {
	return Boolean(user?.roles.includes(ROLE_ADMIN));
}

/** Does this user have an active paid subscription? */
export function isSubscribed(user: WpUser | null): boolean {
	return Boolean(user?.subscription?.isActive);
}

/**
 * Where to send someone after signing in.
 *
 * Only same-origin relative paths are honoured, so `?next=` cannot be used as
 * an open redirect to another site.
 */
export function safeRedirect(next: string | null | undefined, fallback = '/dashboard'): string {
	if (!next) {
		return fallback;
	}

	// Reject protocol-relative (//evil.com) and absolute URLs outright.
	if (!next.startsWith('/') || next.startsWith('//')) {
		return fallback;
	}

	return next;
}
