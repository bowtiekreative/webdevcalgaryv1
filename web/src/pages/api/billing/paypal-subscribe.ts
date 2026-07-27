/**
 * POST /api/billing/paypal-subscribe — start a PayPal subscription.
 *
 * As with Stripe, the plan is resolved from src/config.ts by key so the client
 * cannot name its own PayPal plan id.
 */

import type { APIRoute } from 'astro';
import { currentUser } from '../../../lib/auth/session';
import { verifyCsrf } from '../../../lib/auth/csrf';
import { findPlan, planProviderIds } from '../../../config';
import { createSubscription, paypalConfigured } from '../../../lib/billing/paypal';

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

	if (!(await paypalConfigured())) {
		return fail('PayPal is not configured on this server.');
	}

	const plan = findPlan(String(form.get('plan') ?? ''));

	if (!plan) {
		return fail('Unknown plan.');
	}

	const { paypalPlanId } = await planProviderIds(plan);

	if (!paypalPlanId) {
		return fail(`No PayPal plan is configured for the ${plan.name} plan.`);
	}

	try {
		const origin = context.url.origin;
		const { approveUrl } = await createSubscription({
			planId: paypalPlanId,
			wpUserId: user.id,
			internalPlanId: plan.id,
			email: user.email,
			returnUrl: `${origin}/dashboard/billing?checkout=success`,
			cancelUrl: `${origin}/dashboard/billing?checkout=cancelled`,
		});

		return new Response(null, { status: 303, headers: { Location: approveUrl } });
	} catch (error) {
		console.error('[paypal] subscribe failed:', error);

		return fail('Could not start PayPal checkout. Please try again.');
	}
};
