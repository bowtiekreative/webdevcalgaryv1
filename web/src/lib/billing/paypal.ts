/**
 * PayPal subscriptions.
 *
 * Implemented against the REST API directly rather than @paypal/paypal-server-sdk:
 * that SDK covers Orders and Payments, while recurring billing lives in the
 * Subscriptions API (/v1/billing/*), which it does not wrap. Raw fetch keeps
 * this honest about what is actually being called.
 *
 * Flow: create a subscription against a billing plan -> redirect the user to
 * PayPal's approval URL -> PayPal calls our webhook. As with Stripe, only the
 * webhook writes subscription state.
 */

function env(key: string): string {
	const value =
		(import.meta.env as Record<string, string | undefined>)[key] ??
		(typeof process !== 'undefined' ? process.env?.[key] : undefined);

	return value ?? '';
}

/** Live unless PAYPAL_ENV says otherwise, so a typo cannot silently bill real cards. */
function apiBase(): string {
	return env('PAYPAL_ENV') === 'live'
		? 'https://api-m.paypal.com'
		: 'https://api-m.sandbox.paypal.com';
}

export function paypalConfigured(): boolean {
	return env('PAYPAL_CLIENT_ID').length > 0 && env('PAYPAL_CLIENT_SECRET').length > 0;
}

interface TokenCache {
	token: string;
	expiresAt: number;
}

let tokenCache: TokenCache | null = null;

/** OAuth2 client-credentials token, cached until shortly before expiry. */
async function accessToken(): Promise<string> {
	if (tokenCache && tokenCache.expiresAt > Date.now()) {
		return tokenCache.token;
	}

	const id = env('PAYPAL_CLIENT_ID');
	const secret = env('PAYPAL_CLIENT_SECRET');

	if (!id || !secret) {
		throw new Error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set in web/.env.');
	}

	const response = await fetch(`${apiBase()}/v1/oauth2/token`, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${Buffer.from(`${id}:${secret}`, 'utf8').toString('base64')}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: 'grant_type=client_credentials',
		signal: AbortSignal.timeout(15_000),
	});

	if (!response.ok) {
		throw new Error(`PayPal auth failed (${response.status}): ${await response.text()}`);
	}

	const payload = (await response.json()) as { access_token: string; expires_in: number };

	tokenCache = {
		token: payload.access_token,
		// Refresh a minute early rather than racing the expiry.
		expiresAt: Date.now() + (payload.expires_in - 60) * 1000,
	};

	return tokenCache.token;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
	const response = await fetch(`${apiBase()}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${await accessToken()}`,
			'Content-Type': 'application/json',
			...(init.headers ?? {}),
		},
		signal: AbortSignal.timeout(20_000),
	});

	const text = await response.text();

	if (!response.ok) {
		throw new Error(`PayPal ${path} failed (${response.status}): ${text.slice(0, 400)}`);
	}

	return (text ? JSON.parse(text) : null) as T;
}

interface PayPalLink {
	href: string;
	rel: string;
	method?: string;
}

export interface PayPalSubscription {
	id: string;
	status: string;
	plan_id?: string;
	links?: PayPalLink[];
	billing_info?: { next_billing_time?: string };
	custom_id?: string;
	subscriber?: { email_address?: string };
}

/**
 * Create a subscription and return PayPal's approval URL.
 *
 * `custom_id` carries the WordPress user id through to the webhook, which is
 * the only reliable way to map an event back to an account.
 */
export async function createSubscription(options: {
	planId: string;
	wpUserId: number;
	internalPlanId: string;
	email?: string;
	returnUrl: string;
	cancelUrl: string;
}): Promise<{ id: string; approveUrl: string }> {
	const subscription = await api<PayPalSubscription>('/v1/billing/subscriptions', {
		method: 'POST',
		body: JSON.stringify({
			plan_id: options.planId,
			custom_id: `${options.wpUserId}:${options.internalPlanId}`,
			subscriber: options.email ? { email_address: options.email } : undefined,
			application_context: {
				shipping_preference: 'NO_SHIPPING',
				user_action: 'SUBSCRIBE_NOW',
				return_url: options.returnUrl,
				cancel_url: options.cancelUrl,
			},
		}),
	});

	const approve = subscription.links?.find((link) => link.rel === 'approve')?.href;

	if (!approve) {
		throw new Error('PayPal did not return an approval link.');
	}

	return { id: subscription.id, approveUrl: approve };
}

export function getSubscription(id: string): Promise<PayPalSubscription> {
	return api<PayPalSubscription>(`/v1/billing/subscriptions/${encodeURIComponent(id)}`);
}

export async function cancelSubscription(id: string, reason = 'Cancelled from dashboard'): Promise<void> {
	await api(`/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, {
		method: 'POST',
		body: JSON.stringify({ reason }),
	});
}

/**
 * Verify a webhook came from PayPal.
 *
 * Unlike Stripe's local HMAC check, PayPal verifies signatures server-side, so
 * this costs a round trip. Skipping it would let anyone grant themselves a
 * subscription by POSTing to the endpoint, so it is not optional.
 */
export async function verifyWebhook(options: {
	headers: Headers;
	rawBody: string;
}): Promise<boolean> {
	const webhookId = env('PAYPAL_WEBHOOK_ID');

	if (!webhookId) {
		throw new Error('PAYPAL_WEBHOOK_ID is not set in web/.env.');
	}

	const required = [
		'paypal-auth-algo',
		'paypal-cert-url',
		'paypal-transmission-id',
		'paypal-transmission-sig',
		'paypal-transmission-time',
	];

	if (required.some((header) => !options.headers.get(header))) {
		return false;
	}

	const result = await api<{ verification_status: string }>('/v1/notifications/verify-webhook-signature', {
		method: 'POST',
		body: JSON.stringify({
			auth_algo: options.headers.get('paypal-auth-algo'),
			cert_url: options.headers.get('paypal-cert-url'),
			transmission_id: options.headers.get('paypal-transmission-id'),
			transmission_sig: options.headers.get('paypal-transmission-sig'),
			transmission_time: options.headers.get('paypal-transmission-time'),
			webhook_id: webhookId,
			// Must be the parsed object, not the raw string — PayPal re-serialises
			// it their way before hashing.
			webhook_event: JSON.parse(options.rawBody),
		}),
	});

	return result.verification_status === 'SUCCESS';
}

/** Map a PayPal subscription status onto what we store. */
export function normalizeStatus(status: string): string {
	switch (status.toUpperCase()) {
		case 'ACTIVE':
			return 'active';
		case 'APPROVAL_PENDING':
		case 'APPROVED':
			return 'none';
		case 'SUSPENDED':
			return 'past_due';
		case 'CANCELLED':
		case 'EXPIRED':
			return 'canceled';
		default:
			return 'none';
	}
}

/** Pull the WordPress user id back out of `custom_id`. */
export function parseCustomId(customId: string | undefined): { wpUserId: number; planId: string } | null {
	if (!customId) {
		return null;
	}

	const [rawId, planId = ''] = customId.split(':');
	const wpUserId = Number.parseInt(rawId ?? '', 10);

	return Number.isFinite(wpUserId) ? { wpUserId, planId } : null;
}
