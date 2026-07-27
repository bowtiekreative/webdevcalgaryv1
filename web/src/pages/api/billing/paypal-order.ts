/**
 * POST /api/billing/paypal-order — start a one-time PayPal checkout.
 *
 * The body names *what* is being bought (offer ids from src/config.ts), never
 * *how much*. Amounts are resolved here, so a tampered request buys the same
 * things at the same price.
 *
 * Answers `{ reference, approveUrl }`. The buyer is sent to PayPal; the money
 * only counts once /api/billing/paypal-return captures it.
 */

import type { APIRoute } from 'astro';
import { site } from '../../../config';
import { buildCart, createOrder } from '../../../lib/billing/paypal-orders';
import { paypalConfigured } from '../../../lib/billing/paypal';
import { newReference, recordOrder } from '../../../lib/orders';
import { clientKey, rateLimited } from '../../../lib/rate-limit';

export const prerender = false;

/**
 * A real buyer retries a couple of times at most. Anything past this is a
 * script filling the order queue with junk and running up PayPal API calls.
 */
const LIMIT = 10;
const WINDOW_MS = 10 * 60_000;

interface Body {
	offers?: unknown;
	plan?: unknown;
	speed?: unknown;
	name?: unknown;
	business?: unknown;
	email?: unknown;
	phone?: unknown;
	website?: unknown;
	notes?: unknown;
}

function text(value: unknown, max = 500): string {
	return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function fail(message: string, status = 400): Response {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

export const POST: APIRoute = async (context) => {
	if (
		rateLimited(clientKey(context.request, context.clientAddress), {
			name: 'paypal-order',
			limit: LIMIT,
			windowMs: WINDOW_MS,
		})
	) {
		return fail('Too many attempts. Call us and we will take payment directly.', 429);
	}

	if (!(await paypalConfigured())) {
		return fail('PayPal is not configured on this server. Call us and we will take payment directly.', 503);
	}

	let body: Body;

	try {
		body = (await context.request.json()) as Body;
	} catch {
		return fail('Could not read that request.');
	}

	const offerIds = Array.isArray(body.offers) ? body.offers.filter((id): id is string => typeof id === 'string') : [];
	const cart = buildCart(offerIds);

	if (cart.lines.length === 0) {
		return fail('Nothing selected to pay for.');
	}

	const reference = newReference();
	const email = text(body.email, 200);

	const record = {
		reference,
		status: 'app-pending' as const,
		provider: 'paypal',
		amount: cart.total,
		currency: cart.currency,
		offers: cart.lines.map((line) => line.offer.id).join(','),
		plan: text(body.plan, 40),
		speed: text(body.speed, 40),
		name: text(body.name, 120),
		business: text(body.business, 160),
		email,
		phone: text(body.phone, 40),
		website: text(body.website, 300),
		notes: text(body.notes, 2_000),
		source: context.request.headers.get('referer') ?? '/checkout',
	};

	try {
		const origin = context.url.origin;
		const { id, approveUrl } = await createOrder({
			cart,
			reference,
			brandName: site.name,
			returnUrl: `${origin}/api/billing/paypal-return?ref=${encodeURIComponent(reference)}`,
			cancelUrl: `${origin}/checkout?cancelled=1`,
		});

		// Recorded before the redirect so an abandoned checkout is still
		// visible as an intent, and so the capture has something to update.
		await recordOrder({ ...record, providerId: id });

		return new Response(JSON.stringify({ reference, approveUrl }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('[paypal] could not create order:', error);

		return fail('Could not start checkout. Please try again, or call us and we will take payment directly.', 502);
	}
};
