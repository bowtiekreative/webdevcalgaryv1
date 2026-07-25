/**
 * POST /api/billing/stripe-portal — send the user to Stripe's Billing Portal,
 * where they can change payment method, switch plan or cancel.
 *
 * Using Stripe's hosted portal rather than building cancel/upgrade flows keeps
 * dunning, proration and tax handling on Stripe's side.
 */

import type { APIRoute } from 'astro';
import { currentUser } from '../../../lib/auth/session';
import { verifyCsrf } from '../../../lib/auth/csrf';
import { createPortalSession, stripeConfigured } from '../../../lib/billing/stripe';

export const prerender = false;

function fail(reason: string): Response {
	return new Response(null, {
		status: 303,
		headers: { Location: `/dashboard/billing?error=${encodeURIComponent(reason)}` },
	});
}

export const POST: APIRoute = async (context) => {
	const user = await currentUser(context);

	if (!user) {
		return new Response(null, { status: 303, headers: { Location: '/login?next=/dashboard/billing' } });
	}

	const form = await context.request.formData();

	if (!(await verifyCsrf(context, form.get('csrf')))) {
		return fail('Your session expired. Please try again.');
	}

	if (!stripeConfigured()) {
		return fail('Stripe is not configured on this server.');
	}

	const customerId = user.subscription.stripeCustomerId;

	if (!customerId) {
		return fail('No Stripe customer is linked to this account yet.');
	}

	try {
		const url = await createPortalSession(customerId, `${context.url.origin}/dashboard/billing`);

		return new Response(null, { status: 303, headers: { Location: url } });
	} catch (error) {
		console.error('[stripe] portal failed:', error);

		return fail('Could not open the billing portal.');
	}
};
