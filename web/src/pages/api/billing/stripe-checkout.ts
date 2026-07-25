/**
 * POST /api/billing/stripe-checkout — start a Stripe subscription.
 *
 * The plan comes from src/config.ts by key, never from the client as a price
 * id: accepting a price id from a form would let anyone subscribe themselves to
 * an arbitrary (or cheaper) price.
 */

import type { APIRoute } from 'astro';
import { currentUser } from '../../../lib/auth/session';
import { verifyCsrf } from '../../../lib/auth/csrf';
import { findPlan } from '../../../config';
import { createCheckoutSession, ensureCustomer, stripeConfigured } from '../../../lib/billing/stripe';
import { setSubscription } from '../../../lib/auth/wp';

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

	const plan = findPlan(String(form.get('plan') ?? ''));

	if (!plan) {
		return fail('Unknown plan.');
	}

	if (!plan.stripePriceId) {
		return fail(`No Stripe price is configured for the ${plan.name} plan.`);
	}

	try {
		const customerId = await ensureCustomer({
			wpUserId: user.id,
			email: user.email,
			name: user.displayName,
			existingCustomerId: user.subscription.stripeCustomerId || undefined,
		});

		// Persist the customer id now. It is not subscription state — it just
		// stops us creating a duplicate customer on the next attempt, and the
		// billing portal needs it even if checkout is abandoned.
		if (customerId !== user.subscription.stripeCustomerId) {
			await setSubscription(user.id, { stripeCustomerId: customerId });
		}

		const origin = context.url.origin;
		const url = await createCheckoutSession({
			customerId,
			priceId: plan.stripePriceId,
			wpUserId: user.id,
			planId: plan.id,
			successUrl: `${origin}/dashboard/billing?checkout=success`,
			cancelUrl: `${origin}/dashboard/billing?checkout=cancelled`,
		});

		return new Response(null, { status: 303, headers: { Location: url } });
	} catch (error) {
		console.error('[stripe] checkout failed:', error);

		return fail('Could not start checkout. Please try again.');
	}
};
