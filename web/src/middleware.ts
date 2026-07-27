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
import { siteMode } from './lib/settings';
import { renderSiteModePage } from './lib/site-mode-page';

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

/**
 * Paths that stay reachable while the site is in coming-soon or maintenance
 * mode, so an administrator can still sign in and turn it back off, and so
 * payment providers can still deliver webhooks.
 */
const ALWAYS_OPEN = ['/login', '/dashboard', '/api', '/_refresh'];

export const onRequest = defineMiddleware(async (context, next) => {
	const { pathname } = context.url;

	/*
	 * Maintenance gate.
	 *
	 * Two different moments, and the difference matters:
	 *
	 *  - At BUILD time Astro runs middleware while prerendering, so a build
	 *    started while the mode is not "live" bakes the gate into every static
	 *    page. That is the mechanism that gates the public site, and it works on
	 *    any host, including a pure CDN with no server.
	 *  - At RUNTIME it only covers on-demand routes (/login, /dashboard, /api).
	 *    Prerendered pages are served straight off disk by the adapter and never
	 *    reach middleware, so flipping the toggle does not change them until the
	 *    next build. app-settings.php fires the build hook on change for exactly
	 *    that reason.
	 *
	 * The admin bypass below therefore only ever fires for on-demand routes.
	 * Prerendered routes carry no session at all — verified, and true in `astro
	 * dev` as well as in production — so there is no signed-in user to
	 * recognise there. Use SITE_MODE=live in web/.env to work locally while
	 * production is gated.
	 */
	if (!matches(pathname, ALWAYS_OPEN) && !pathname.startsWith('/_astro/')) {
		const mode = await siteMode();

		if (mode.mode !== 'live') {
			// Signed-in admins keep browsing, so the site can be checked before
			// it goes public.
			const viewer = await currentUser(context);

			if (!isAdmin(viewer)) {
				return renderSiteModePage(mode);
			}
		}
	}

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
