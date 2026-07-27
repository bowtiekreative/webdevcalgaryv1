/**
 * POST /api/billing/stripe-webhook
 *
 * The only writer of Stripe subscription state. A browser returning from
 * Checkout proves nothing — the user can close the tab, and the redirect is
 * forgeable — so access is granted here or not at all.
 *
 * Every event is signature-verified against STRIPE_WEBHOOK_SECRET using the
 * raw request body; re-serialising the JSON would invalidate the signature.
 *
 * Local testing:
 *   stripe listen --forward-to localhost:4321/api/billing/stripe-webhook
 */

import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { constructWebhookEvent, normalizeStatus, stripe } from '../../../lib/billing/stripe';
import { lookupUser, setSubscription } from '../../../lib/auth/wp';

export const prerender = false;

/** ISO timestamp from a Stripe unix seconds value. */
function isoFrom(seconds: number | null | undefined): string {
	return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : '';
}

/**
 * Resolve the WordPress user for a subscription.
 *
 * Prefers metadata written at Checkout; falls back to the customer id, then the
 * customer's email, so a subscription created directly in the Stripe dashboard
 * still lands on the right account.
 */
async function resolveUserId(subscription: Stripe.Subscription): Promise<number | null> {
	const fromMetadata = Number.parseInt(subscription.metadata?.wpUserId ?? '', 10);

	if (Number.isFinite(fromMetadata) && fromMetadata > 0) {
		return fromMetadata;
	}

	const customerId =
		typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;

	if (!customerId) {
		return null;
	}

	const byCustomer = await lookupUser('stripe_customer', customerId);

	if (byCustomer) {
		return byCustomer.id;
	}

	try {
		const customer = await (await stripe()).customers.retrieve(customerId);

		if (!customer.deleted && customer.email) {
			const byEmail = await lookupUser('email', customer.email);

			return byEmail?.id ?? null;
		}
	} catch {
		// Nothing more to try.
	}

	return null;
}

/**
 * Pull the subscription id off an invoice.
 *
 * Stripe moved this: older API versions put it at `invoice.subscription`, newer
 * ones nest it under `invoice.parent.subscription_details.subscription`. Both
 * are checked so the handler survives an account-level API version change.
 */
function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
	const legacy = (invoice as unknown as { subscription?: string | { id?: string } | null }).subscription;

	if (typeof legacy === 'string') {
		return legacy;
	}

	if (legacy && typeof legacy === 'object' && typeof legacy.id === 'string') {
		return legacy.id;
	}

	const modern = (
		invoice as unknown as {
			parent?: { subscription_details?: { subscription?: string | { id?: string } | null } | null } | null;
		}
	).parent?.subscription_details?.subscription;

	if (typeof modern === 'string') {
		return modern;
	}

	if (modern && typeof modern === 'object' && typeof modern.id === 'string') {
		return modern.id;
	}

	return null;
}

async function applySubscription(subscription: Stripe.Subscription): Promise<void> {
	const userId = await resolveUserId(subscription);

	if (!userId) {
		console.warn(`[stripe] no WordPress user for subscription ${subscription.id}; ignoring.`);

		return;
	}

	const customerId =
		typeof subscription.customer === 'string' ? subscription.customer : (subscription.customer?.id ?? '');

	// `current_period_end` lives on the subscription item in recent API
	// versions; fall back to the top level for older payloads.
	const periodEnd =
		subscription.items?.data?.[0]?.current_period_end ??
		(subscription as unknown as { current_period_end?: number }).current_period_end;

	await setSubscription(userId, {
		provider: 'stripe',
		id: subscription.id,
		status: normalizeStatus(subscription.status),
		plan: subscription.metadata?.planId ?? '',
		renewsAt: isoFrom(periodEnd),
		stripeCustomerId: customerId,
	});

	console.info(`[stripe] user ${userId} -> ${subscription.status} (${subscription.id})`);
}

export const POST: APIRoute = async ({ request }) => {
	const signature = request.headers.get('stripe-signature');

	if (!signature) {
		return new Response('Missing signature', { status: 400 });
	}

	// Raw text, before any parsing — the signature covers these exact bytes.
	const rawBody = await request.text();

	let event: Stripe.Event;

	try {
		event = await constructWebhookEvent(rawBody, signature);
	} catch (error) {
		console.warn('[stripe] signature verification failed:', error);

		return new Response('Invalid signature', { status: 400 });
	}

	try {
		switch (event.type) {
			case 'customer.subscription.created':
			case 'customer.subscription.updated':
			case 'customer.subscription.deleted':
				await applySubscription(event.data.object);
				break;

			case 'checkout.session.completed': {
				// Checkout only tells us a subscription exists; read it back for
				// the authoritative status and period rather than assuming active.
				const session = event.data.object;
				const subscriptionId =
					typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;

				if (subscriptionId) {
					await applySubscription(await (await stripe()).subscriptions.retrieve(subscriptionId));
				}

				break;
			}

			case 'invoice.payment_failed': {
				const subscriptionId = subscriptionIdFromInvoice(event.data.object);

				if (subscriptionId) {
					await applySubscription(await (await stripe()).subscriptions.retrieve(subscriptionId));
				}

				break;
			}

			default:
				// Everything else is acknowledged and ignored; Stripe retries
				// non-2xx responses, so never fail on an event we don't handle.
				break;
		}
	} catch (error) {
		console.error(`[stripe] handling ${event.type} failed:`, error);

		// 500 asks Stripe to retry, which is what we want for a transient
		// WordPress outage.
		return new Response('Handler error', { status: 500 });
	}

	return new Response(JSON.stringify({ received: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
