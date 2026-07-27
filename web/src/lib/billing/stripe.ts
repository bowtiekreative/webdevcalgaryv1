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
import { setting } from '../settings';

let cached: { key: string; client: Stripe } | null = null;

export async function stripeConfigured(): Promise<boolean> {
	return (await setting('STRIPE_SECRET_KEY')).length > 0;
}

/**
 * The Stripe client.
 *
 * Async because the key may come from wp-admin rather than the environment.
 * The client is cached against the key it was built with, so rotating the key
 * in wp-admin swaps the client on the next call instead of needing a restart.
 */
export async function stripe(): Promise<Stripe> {
	const key = await setting('STRIPE_SECRET_KEY');

	if (!key) {
		throw new Error(
			'No Stripe secret key. Set STRIPE_SECRET_KEY in web/.env, or add it under Settings -> App Settings in wp-admin.',
		);
	}

	if (!cached || cached.key !== key) {
		cached = { key, client: new Stripe(key) };
	}

	return cached.client;
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
	const client = await stripe();

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
	const session = await (await stripe()).checkout.sessions.create({
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
	const session = await (await stripe()).billingPortal.sessions.create({
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
export async function constructWebhookEvent(payload: string, signature: string): Promise<Stripe.Event> {
	const secret = await setting('STRIPE_WEBHOOK_SECRET');

	if (!secret) {
		throw new Error(
			'No Stripe webhook secret. Set STRIPE_WEBHOOK_SECRET in web/.env, or add it under Settings -> App Settings.',
		);
	}

	return (await stripe()).webhooks.constructEvent(payload, signature, secret);
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
