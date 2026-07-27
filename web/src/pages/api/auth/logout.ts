/**
 * POST /api/auth/logout
 *
 * POST-only and CSRF-checked: a GET logout can be triggered by any image tag
 * on any page, which is a small but pointless annoyance to leave open.
 */

import type { APIRoute } from 'astro';
import { endSession } from '../../../lib/auth/session';
import { verifyCsrf } from '../../../lib/auth/csrf';

export const prerender = false;

export const POST: APIRoute = async (context) => {
	const form = await context.request.formData();

	if (await verifyCsrf(context, form.get('csrf'))) {
		await endSession(context);
	}

	return new Response(null, { status: 303, headers: { Location: '/' } });
};
