/**
 * PayPal one-time orders — the funnel's ecommerce.
 *
 * The subscriptions API (paypal.ts) bills the $147/$497 monthly plans. Everything
 * else on the offer ladder is a single charge: the $497 rush fee, the $47
 * teardown, the $97 GBP Rescue bump, the $297 Website Rescue downsell. Those go
 * through /v2/checkout/orders instead.
 *
 * Two rules hold this together:
 *
 *   1. **The browser never names a price.** It posts offer *ids*; the amount is
 *      looked up from src/config.ts here, server-side. A tampered request buys
 *      the same thing at the same price.
 *   2. **Only a capture counts as paid.** Creating an order is free and proves
 *      nothing. The thank-you page and the fulfilment email hang off the
 *      capture result, never off the redirect back from PayPal.
 */

import { CURRENCY, findOffer, type Offer } from '../../config';
import { paypalApi } from './paypal';

export interface CartLine {
	offer: Offer;
	quantity: number;
}

export interface Cart {
	lines: CartLine[];
	total: number;
	currency: string;
}

/**
 * Turn a list of offer ids into a priced cart.
 *
 * Unknown ids are dropped rather than throwing: a stale link with a retired
 * offer should still let someone buy the rest, not show them an error page.
 */
export function buildCart(offerIds: string[]): Cart {
	const lines: CartLine[] = [];

	for (const id of offerIds) {
		const offer = findOffer(id);

		if (!offer) {
			continue;
		}

		const existing = lines.find((line) => line.offer.id === offer.id);

		if (existing) {
			existing.quantity += 1;
		} else {
			lines.push({ offer, quantity: 1 });
		}
	}

	const total = lines.reduce((sum, line) => sum + line.offer.amount * line.quantity, 0);

	return { lines, total, currency: CURRENCY };
}

/** PayPal wants amounts as fixed-2 strings, never numbers. */
function money(amount: number): string {
	return amount.toFixed(2);
}

interface PayPalLink {
	href: string;
	rel: string;
}

export interface PayPalOrder {
	id: string;
	status: string;
	links?: PayPalLink[];
	purchase_units?: Array<{
		custom_id?: string;
		reference_id?: string;
		amount?: { value?: string; currency_code?: string };
		payments?: {
			captures?: Array<{ id: string; status: string; amount?: { value?: string; currency_code?: string } }>;
		};
	}>;
	payer?: {
		email_address?: string;
		name?: { given_name?: string; surname?: string };
	};
}

/**
 * Create an order and return the URL to send the buyer to.
 *
 * `custom_id` carries our own reference through to the capture and to any
 * webhook, which is the only reliable way to tie a PayPal payment back to the
 * lead that started it.
 */
export async function createOrder(options: {
	cart: Cart;
	/** Our reference, echoed back on capture. Keep it under 127 chars. */
	reference: string;
	returnUrl: string;
	cancelUrl: string;
	brandName: string;
}): Promise<{ id: string; approveUrl: string }> {
	if (options.cart.lines.length === 0 || options.cart.total <= 0) {
		throw new Error('Nothing to pay for.');
	}

	const items = options.cart.lines.map((line) => ({
		name: line.offer.name.slice(0, 127),
		description: line.offer.description.slice(0, 127),
		sku: line.offer.serial,
		quantity: String(line.quantity),
		unit_amount: { currency_code: options.cart.currency, value: money(line.offer.amount) },
	}));

	const order = await paypalApi<PayPalOrder>('/v2/checkout/orders', {
		method: 'POST',
		body: JSON.stringify({
			intent: 'CAPTURE',
			purchase_units: [
				{
					custom_id: options.reference.slice(0, 127),
					description: options.cart.lines
						.map((line) => line.offer.name)
						.join(' + ')
						.slice(0, 127),
					items,
					amount: {
						currency_code: options.cart.currency,
						value: money(options.cart.total),
						breakdown: {
							item_total: { currency_code: options.cart.currency, value: money(options.cart.total) },
						},
					},
				},
			],
			payment_source: {
				paypal: {
					experience_context: {
						brand_name: options.brandName,
						shipping_preference: 'NO_SHIPPING',
						user_action: 'PAY_NOW',
						return_url: options.returnUrl,
						cancel_url: options.cancelUrl,
					},
				},
			},
		}),
	});

	const approve = order.links?.find((link) => link.rel === 'payer-action' || link.rel === 'approve')?.href;

	if (!approve) {
		throw new Error('PayPal did not return an approval link.');
	}

	return { id: order.id, approveUrl: approve };
}

export interface CaptureResult {
	orderId: string;
	captureId: string | null;
	status: string;
	paid: boolean;
	amount: number;
	currency: string;
	reference: string | null;
	payerEmail: string | null;
	payerName: string | null;
}

/**
 * Capture an approved order. This is the moment money moves.
 *
 * PayPal returns 422 ORDER_ALREADY_CAPTURED if this runs twice — someone
 * refreshing the return URL, or a retried webhook. That is treated as success
 * by re-reading the order, so a double-submit does not look like a failure to
 * a customer who has already paid.
 */
export async function captureOrder(orderId: string): Promise<CaptureResult> {
	let order: PayPalOrder;

	try {
		order = await paypalApi<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
			method: 'POST',
			body: '{}',
		});
	} catch (error) {
		if (error instanceof Error && error.message.includes('ORDER_ALREADY_CAPTURED')) {
			order = await getOrder(orderId);
		} else {
			throw error;
		}
	}

	return readOrder(order);
}

export function getOrder(orderId: string): Promise<PayPalOrder> {
	return paypalApi<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}

/** Flatten PayPal's nesting into the handful of fields fulfilment needs. */
export function readOrder(order: PayPalOrder): CaptureResult {
	const unit = order.purchase_units?.[0];
	const capture = unit?.payments?.captures?.[0];
	const amount = capture?.amount ?? unit?.amount;

	const payerName = [order.payer?.name?.given_name, order.payer?.name?.surname]
		.filter(Boolean)
		.join(' ');

	return {
		orderId: order.id,
		captureId: capture?.id ?? null,
		status: capture?.status ?? order.status,
		// COMPLETED is the only status that means the money arrived. PENDING
		// exists (review holds) and must not unlock fulfilment.
		paid: (capture?.status ?? order.status) === 'COMPLETED',
		amount: Number.parseFloat(amount?.value ?? '0') || 0,
		currency: amount?.currency_code ?? CURRENCY,
		reference: unit?.custom_id ?? null,
		payerEmail: order.payer?.email_address ?? null,
		payerName: payerName || null,
	};
}
