/**
 * POST /api/billing/paypal-webhook
 *
 * The only writer of PayPal subscription state.
 *
 * PayPal verifies signatures server-side rather than with a local HMAC, so
 * every event costs a round trip to their API. That is not skippable: without
 * it, anyone who knows this URL could POST themselves an active subscription.
 */

import type { APIRoute } from 'astro';
import {
	getSubscription,
	normalizeStatus,
	parseCustomId,
	verifyWebhook,
	type PayPalSubscription,
} from '../../../lib/billing/paypal';
import { lookupUser, setSubscription } from '../../../lib/auth/wp';

export const prerender = false;

interface PayPalEvent {
	event_type?: string;
	resource?: PayPalSubscription & { id?: string };
}

/** Subscription lifecycle events. Payment events are informational for us. */
const SUBSCRIPTION_EVENTS = new Set([
	'BILLING.SUBSCRIPTION.ACTIVATED',
	'BILLING.SUBSCRIPTION.CREATED',
	'BILLING.SUBSCRIPTION.UPDATED',
	'BILLING.SUBSCRIPTION.CANCELLED',
	'BILLING.SUBSCRIPTION.SUSPENDED',
	'BILLING.SUBSCRIPTION.EXPIRED',
	'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
]);

async function resolveUserId(subscription: PayPalSubscription): Promise<number | null> {
	const fromCustom = parseCustomId(subscription.custom_id);

	if (fromCustom) {
		return fromCustom.wpUserId;
	}

	// Fall back to the subscription id we may already have stored, then email.
	const bySubscription = await lookupUser('subscription', subscription.id);

	if (bySubscription) {
		return bySubscription.id;
	}

	const email = subscription.subscriber?.email_address;

	if (email) {
		const byEmail = await lookupUser('email', email);

		return byEmail?.id ?? null;
	}

	return null;
}

export const POST: APIRoute = async ({ request }) => {
	const rawBody = await request.text();

	let verified = false;

	try {
		verified = await verifyWebhook({ headers: request.headers, rawBody });
	} catch (error) {
		console.error('[paypal] webhook verification error:', error);

		// Configuration problem rather than a bad event — 500 so PayPal retries
		// once it is fixed.
		return new Response('Verification unavailable', { status: 500 });
	}

	if (!verified) {
		console.warn('[paypal] rejected an unverified webhook.');

		return new Response('Invalid signature', { status: 400 });
	}

	let event: PayPalEvent;

	try {
		event = JSON.parse(rawBody) as PayPalEvent;
	} catch {
		return new Response('Invalid JSON', { status: 400 });
	}

	const type = event.event_type ?? '';

	if (!SUBSCRIPTION_EVENTS.has(type) || !event.resource?.id) {
		// Acknowledge anything else so PayPal stops retrying it.
		return new Response(JSON.stringify({ received: true }), { status: 200 });
	}

	try {
		// Re-read rather than trusting the event body: it is the authoritative
		// status, and it fills in fields a lifecycle event may omit.
		const subscription = await getSubscription(event.resource.id);
		const userId = await resolveUserId(subscription);

		if (!userId) {
			console.warn(`[paypal] no WordPress user for subscription ${subscription.id}; ignoring.`);

			return new Response(JSON.stringify({ received: true }), { status: 200 });
		}

		const planId = parseCustomId(subscription.custom_id)?.planId ?? '';

		await setSubscription(userId, {
			provider: 'paypal',
			id: subscription.id,
			status: normalizeStatus(subscription.status),
			plan: planId,
			renewsAt: subscription.billing_info?.next_billing_time ?? '',
		});

		console.info(`[paypal] user ${userId} -> ${subscription.status} (${subscription.id})`);
	} catch (error) {
		console.error(`[paypal] handling ${type} failed:`, error);

		return new Response('Handler error', { status: 500 });
	}

	return new Response(JSON.stringify({ received: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
