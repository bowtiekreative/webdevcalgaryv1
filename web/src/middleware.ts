/**
 * Route protection.
 *
 * Guarding here rather than in each page means a new file under /dashboard is
 * protected by default — the failure mode of forgetting a check is a redirect
 * to login, not an information leak.
 *
 * `locals.user` is populated once per request so pages don't each re-fetch it.
 */

import { defineMiddleware } from 'astro:middleware';
import { currentUser, isAdmin } from './lib/auth/session';

/** Prefixes that require a signed-in user. */
const PROTECTED = ['/dashboard'];

/**
 * Prefixes that additionally require the administrator role.
 *
 * The pages themselves re-check too. That redundancy is deliberate: this list
 * is easy to forget to update when adding a page, so neither layer is trusted
 * as the only guard.
 */
const ADMIN_ONLY = ['/dashboard/users', '/dashboard/marketing'];

function matches(pathname: string, prefixes: string[]): boolean {
	return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export const onRequest = defineMiddleware(async (context, next) => {
	const { pathname } = context.url;

	// Static routes have no session; skip the work entirely.
	if (!matches(pathname, PROTECTED) && pathname !== '/login') {
		return next();
	}

	const user = await currentUser(context);
	context.locals.user = user;

	if (matches(pathname, PROTECTED) && !user) {
		// Preserve where they were heading so login can send them back.
		const next_ = encodeURIComponent(pathname + context.url.search);

		return context.redirect(`/login?next=${next_}`, 302);
	}

	if (matches(pathname, ADMIN_ONLY) && !isAdmin(user)) {
		// 404 rather than 403: don't confirm that an admin area exists here.
		return new Response('Not found', { status: 404 });
	}

	// Already signed in and staring at the login page — send them onward.
	if (pathname === '/login' && user) {
		return context.redirect('/dashboard', 302);
	}

	return next();
});
