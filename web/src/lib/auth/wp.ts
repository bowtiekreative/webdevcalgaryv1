/**
 * Client for the WordPress auth/billing REST API.
 *
 * WordPress is the user store; this is the only module that talks to it about
 * users. Everything goes over a shared secret that never leaves the server —
 * see wordpress/mu-plugins/app-auth.php for the other half.
 */

export interface Subscription {
	provider: 'stripe' | 'paypal' | '';
	id: string;
	status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'none' | string;
	plan: string;
	renewsAt: string;
	isActive: boolean;
	stripeCustomerId: string;
}

export interface WpUser {
	id: number;
	email: string;
	login: string;
	displayName: string;
	firstName: string;
	lastName: string;
	roles: string[];
	avatarUrl: string;
	registered: string;
	subscription: Subscription;
}

export class WpAuthError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(message: string, status: number, code = 'app_error') {
		super(message);
		this.name = 'WpAuthError';
		this.status = status;
		this.code = code;
	}
}

function env(key: string): string {
	const value =
		(import.meta.env as Record<string, string | undefined>)[key] ??
		(typeof process !== 'undefined' ? process.env?.[key] : undefined);

	return value ?? '';
}

/** Base of the WordPress REST API, derived from the GraphQL endpoint. */
function apiBase(): string {
	const endpoint = env('WP_GRAPHQL_ENDPOINT') || 'http://localhost:8080/graphql';

	try {
		return `${new URL(endpoint).origin}/wp-json/app/v1`;
	} catch {
		return 'http://localhost:8080/wp-json/app/v1';
	}
}

function sharedSecret(): string {
	const secret = env('WP_SHARED_SECRET');

	if (!secret) {
		throw new WpAuthError(
			'WP_SHARED_SECRET is not set in web/.env. Generate one with `openssl rand -hex 32` and set the same value as APP_SHARED_SECRET in the root .env.',
			500,
			'app_not_configured',
		);
	}

	return secret;
}

interface ErrorBody {
	code?: string;
	message?: string;
}

/**
 * Authenticated call to the WordPress app API.
 *
 * Exported so lib/leads.ts can reach /wp-json/app/v1/leads over the same
 * shared secret rather than growing a second, subtly different client.
 */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	let response: Response;

	try {
		response = await fetch(`${apiBase()}${path}`, {
			...init,
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json',
				'X-App-Secret': sharedSecret(),
				...(init.headers ?? {}),
			},
			signal: AbortSignal.timeout(15_000),
		});
	} catch (error) {
		if (error instanceof WpAuthError) {
			throw error;
		}

		throw new WpAuthError(
			`Could not reach WordPress at ${apiBase()}. Is the stack running?`,
			503,
			'app_unreachable',
		);
	}

	const text = await response.text();
	const body = text ? (JSON.parse(text) as unknown) : null;

	if (!response.ok) {
		const error = (body ?? {}) as ErrorBody;

		throw new WpAuthError(
			error.message ?? `WordPress returned ${response.status}.`,
			response.status,
			error.code ?? 'app_error',
		);
	}

	return body as T;
}

/**
 * Verify credentials.
 *
 * Throws WpAuthError with status 401 for bad credentials and 429 when the
 * account is being rate limited — both carry a message safe to show the user.
 */
export async function login(loginName: string, password: string): Promise<WpUser> {
	const { user } = await request<{ user: WpUser }>('/auth/login', {
		method: 'POST',
		body: JSON.stringify({ login: loginName, password }),
	});

	return user;
}

/** Re-read a user, so roles and subscription are never stale in a session. */
export async function getUser(id: number): Promise<WpUser | null> {
	try {
		const { user } = await request<{ user: WpUser }>(`/auth/user/${id}`);

		return user;
	} catch (error) {
		if (error instanceof WpAuthError && error.status === 404) {
			return null;
		}

		throw error;
	}
}

/** List users for the admin table. Bounded server-side at 200 per page. */
export async function listUsers(options: { page?: number; perPage?: number; search?: string } = {}): Promise<{
	users: WpUser[];
	total: number;
}> {
	const query = new URLSearchParams({
		page: String(options.page ?? 1),
		per_page: String(options.perPage ?? 50),
	});

	if (options.search) {
		query.set('search', options.search);
	}

	return request<{ users: WpUser[]; total: number }>(`/auth/users?${query.toString()}`);
}

/** Trigger WordPress's password reset email. Always resolves. */
export async function requestPasswordReset(loginName: string): Promise<void> {
	await request('/auth/reset', {
		method: 'POST',
		body: JSON.stringify({ login: loginName }),
	});
}

/** Write subscription state. Called by the payment webhooks. */
export async function setSubscription(
	userId: number,
	data: Partial<Omit<Subscription, 'isActive'>>,
): Promise<Subscription> {
	const { subscription } = await request<{ subscription: Subscription }>(`/billing/${userId}`, {
		method: 'POST',
		body: JSON.stringify(data),
	});

	return subscription;
}

/**
 * Find a user from an identifier a payment provider gave us.
 *
 * Webhooks arrive carrying Stripe/PayPal ids, never WordPress user ids.
 */
export async function lookupUser(
	by: 'stripe_customer' | 'subscription' | 'email',
	value: string,
): Promise<{ id: number; email: string } | null> {
	try {
		const { user } = await request<{ user: { id: number; email: string } }>(
			`/billing/lookup?by=${encodeURIComponent(by)}&value=${encodeURIComponent(value)}`,
		);

		return user;
	} catch (error) {
		if (error instanceof WpAuthError && error.status === 404) {
			return null;
		}

		throw error;
	}
}
