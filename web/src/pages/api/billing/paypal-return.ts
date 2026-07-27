/**
 * GET /api/billing/paypal-return — where PayPal sends the buyer back.
 *
 * This is the only place a payment becomes real. PayPal appends `token` (the
 * order id); we capture it, and only a COMPLETED capture flips the order to
 * paid, starts the 24-hour clock and sends the confirmation.
 *
 * The redirect alone proves nothing — a buyer can reach this URL by hand — so
 * nothing here trusts the query string beyond using it to look the order up.
 */

import type { APIRoute } from 'astro';
import { captureOrder } from '../../../lib/billing/paypal-orders';
import { fetchOrder, goLiveDeadline, notifyPaid, recordOrder } from '../../../lib/orders';

export const prerender = false;

function redirect(path: string): Response {
	return new Response(null, { status: 303, headers: { Location: path } });
}

export const GET: APIRoute = async (context) => {
	const orderId = context.url.searchParams.get('token');
	const reference = context.url.searchParams.get('ref') ?? '';

	if (!orderId) {
		return redirect('/checkout?error=missing-order');
	}

	let result;

	try {
		result = await captureOrder(orderId);
	} catch (error) {
		console.error('[paypal] capture failed:', orderId, error);

		// The money may or may not have moved. Send them somewhere that says
		// so plainly rather than a thank-you page that might be a lie.
		return redirect(`/checkout?error=capture&ref=${encodeURIComponent(reference)}`);
	}

	if (!result.paid) {
		// PENDING happens (PayPal review holds). It is not a failure and it is
		// not a sale — record it and tell them we will confirm by email.
		await recordOrder({
			reference: result.reference || reference,
			status: 'app-pending',
			provider: 'paypal',
			providerId: result.orderId,
			captureId: result.captureId ?? undefined,
			amount: result.amount,
			currency: result.currency,
			email: result.payerEmail ?? undefined,
		});

		return redirect(`/checkout?pending=1&ref=${encodeURIComponent(result.reference || reference)}`);
	}

	const deadline = goLiveDeadline();
	const ref = result.reference || reference;

	// What the buyer typed at checkout — business name, phone, the notes that
	// say what the site is for. PayPal's payer record has none of that, and the
	// build email is useless without it.
	const stored = await fetchOrder(ref);

	const order = {
		reference: ref,
		status: 'app-paid' as const,
		provider: 'paypal',
		providerId: result.orderId,
		captureId: result.captureId ?? undefined,
		amount: result.amount,
		currency: result.currency,
		// Prefer the address they gave us; fall back to the PayPal account's.
		email: stored?.email || result.payerEmail || undefined,
		name: stored?.name || result.payerName || undefined,
		business: stored?.business,
		phone: stored?.phone,
		website: stored?.website,
		notes: stored?.notes,
		offers: stored?.offers,
		plan: stored?.plan,
		goLiveAt: deadline.toISOString(),
	};

	await recordOrder(order);
	await notifyPaid({ ...order, deadline });

	return redirect(`/thank-you?ref=${encodeURIComponent(order.reference)}`);
};
