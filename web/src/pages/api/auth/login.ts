/**
 * POST /api/auth/login — form target for the sign-in page.
 *
 * Responds with a redirect rather than JSON so the page works without any
 * client-side JavaScript.
 */

import type { APIRoute } from 'astro';
import { login, WpAuthError } from '../../../lib/auth/wp';
import { startSession, safeRedirect } from '../../../lib/auth/session';
import { verifyCsrf } from '../../../lib/auth/csrf';

export const prerender = false;

function back(message: string, next: string | null, email: string): Response {
	const params = new URLSearchParams({ error: message, email });

	if (next) {
		params.set('next', next);
	}

	return new Response(null, {
		status: 303,
		headers: { Location: `/login?${params.toString()}` },
	});
}

export const POST: APIRoute = async (context) => {
	const form = await context.request.formData();
	const email = String(form.get('email') ?? '').trim();
	const password = String(form.get('password') ?? '');
	const next = form.get('next') ? String(form.get('next')) : null;

	if (!(await verifyCsrf(context, form.get('csrf')))) {
		return back('Your session expired. Please try again.', next, email);
	}

	if (!email || !password) {
		return back('Enter your email and password.', next, email);
	}

	try {
		const user = await login(email, password);
		await startSession(context, user);

		return new Response(null, {
			status: 303,
			headers: { Location: safeRedirect(next) },
		});
	} catch (error) {
		if (error instanceof WpAuthError) {
			// 401 and 429 carry messages written to be shown to a user; anything
			// else is a configuration or outage problem and gets a generic line
			// so internals are not leaked to the login form.
			const message =
				error.status === 401 || error.status === 429
					? error.message
					: 'Sign-in is unavailable right now. Please try again shortly.';

			if (error.status >= 500) {
				console.error('[auth] login failed:', error.message);
			}

			return back(message, next, email);
		}

		console.error('[auth] unexpected login error:', error);

		return back('Sign-in is unavailable right now.', next, email);
	}
};
