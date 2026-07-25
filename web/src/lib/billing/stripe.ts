/**
 * Stripe subscriptions.
 *
 * Checkout in `subscription` mode plus the Billing Portal — deliberately no
 * card handling of our own, so card data never touches this server and PCI
 * scope stays with Stripe.
 *
 * Subscription state is mirrored onto the WordPress user by the webhook, never
 * by the browser returning from Checkout: a user can close the tab before the
 * redirect, and a redirect is trivially forgeable. The webhook is the only
 * writer.
 */

import Stripe from 'stripe';

let cached: Stripe | null = null;

function env(key: string): string {
	const value =
		(import.meta.env as Record<string, string | undefined>)[key] ??
		(typeof process !== 'undefined' ? process.env?.[key] : undefined);

	return value ?? '';
}

export function stripeConfigured(): boolean {
	return env('STRIPE_SECRET_KEY').length > 0;
}

export function stripe(): Stripe {
	if (!cached) {
		const key = env('STRIPE_SECRET_KEY');

		if (!key) {
			throw new Error('STRIPE_SECRET_KEY is not set in web/.env.');
		}

		cached = new Stripe(key);
	}

	return cached;
}

/**
 * Find or create the Stripe customer for a WordPress user.
 *
 * `wpUserId` goes into metadata so a webhook can map back to WordPress even if
 * the local record is lost.
 */
export async function ensureCustomer(options: {
	wpUserId: number;
	email: string;
	name?: string;
	existingCustomerId?: string;
}): Promise<string> {
	const client = stripe();

	if (options.existingCustomerId) {
		try {
			const existing = await client.customers.retrieve(options.existingCustomerId);

			if (!existing.deleted) {
				return existing.id;
			}
		} catch {
			// Fall through and make a new one — a stale id is not fatal.
		}
	}

	const customer = await client.customers.create({
		email: options.email,
		name: options.name,
		metadata: { wpUserId: String(options.wpUserId) },
	});

	return customer.id;
}

/** Create a Checkout session for a subscription price. */
export async function createCheckoutSession(options: {
	customerId: string;
	priceId: string;
	wpUserId: number;
	planId: string;
	successUrl: string;
	cancelUrl: string;
}): Promise<string> {
	const session = await stripe().checkout.sessions.create({
		mode: 'subscription',
		customer: options.customerId,
		line_items: [{ price: options.priceId, quantity: 1 }],
		success_url: options.successUrl,
		cancel_url: options.cancelUrl,
		allow_promotion_codes: true,
		// Present on both the session and the resulting subscription, so every
		// webhook event can be traced back to a WordPress user and plan.
		metadata: { wpUserId: String(options.wpUserId), planId: options.planId },
		subscription_data: {
			metadata: { wpUserId: String(options.wpUserId), planId: options.planId },
		},
	});

	if (!session.url) {
		throw new Error('Stripe did not return a Checkout URL.');
	}

	return session.url;
}

/** Billing Portal session, where the user manages or cancels the subscription. */
export async function createPortalSession(customerId: string, returnUrl: string): Promise<string> {
	const session = await stripe().billingPortal.sessions.create({
		customer: customerId,
		return_url: returnUrl,
	});

	return session.url;
}

/**
 * Verify a webhook signature and return the event.
 *
 * Must be given the *raw* request body: Stripe signs the exact bytes, so
 * anything that re-serialises the JSON invalidates the signature.
 */
export function constructWebhookEvent(payload: string, signature: string): Stripe.Event {
	const secret = env('STRIPE_WEBHOOK_SECRET');

	if (!secret) {
		throw new Error('STRIPE_WEBHOOK_SECRET is not set in web/.env.');
	}

	return stripe().webhooks.constructEvent(payload, signature, secret);
}

/** Map a Stripe subscription status onto what we store. */
export function normalizeStatus(status: Stripe.Subscription.Status): string {
	switch (status) {
		case 'active':
		case 'trialing':
		case 'past_due':
			return status;
		case 'canceled':
		case 'incomplete_expired':
		case 'unpaid':
			return 'canceled';
		default:
			// incomplete / paused — not yet paid for, so not access-granting.
			return 'none';
	}
}
