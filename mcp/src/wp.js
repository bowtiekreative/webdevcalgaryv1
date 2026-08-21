/**
 * The two ways into WordPress, and why there are two.
 *
 * `app()`      — the app API at /wp-json/app/v1, authenticated with the shared
 *                secret the Astro server already uses. Leads and settings live
 *                here. No WordPress user is involved.
 *
 * `graphql()`  — WPGraphQL, for reading published content. Unauthenticated,
 *                because that is exactly what the public site reads.
 *
 * `wpRest()`   — core REST at /wp-json/wp/v2, authenticated with an application
 *                password. This is the only path that can *write* content, and
 *                the only one that needs a real WordPress user, which is why it
 *                is optional: without WP_APPLICATION_PASSWORD the server still
 *                runs, and the content-write tools refuse with an explanation
 *                rather than failing mysteriously.
 */

const TIMEOUT_MS = 20_000;

export class WpError extends Error {
	constructor(message, status = 500) {
		super(message);
		this.name = 'WpError';
		this.status = status;
	}
}

function env(key) {
	return (process.env[key] ?? '').trim();
}

export function config() {
	const endpoint = env('WP_GRAPHQL_ENDPOINT') || 'http://localhost:8080/graphql';

	let origin;

	try {
		origin = new URL(endpoint).origin;
	} catch {
		throw new WpError(`WP_GRAPHQL_ENDPOINT is not a valid URL: ${endpoint}`);
	}

	return {
		endpoint,
		origin,
		secret: env('WP_SHARED_SECRET'),
		appPassword: env('WP_APPLICATION_PASSWORD'),
	};
}

async function json(response, label) {
	const text = await response.text();
	const body = text ? JSON.parse(text) : null;

	if (!response.ok) {
		throw new WpError(body?.message ?? `${label} returned ${response.status}`, response.status);
	}

	return body;
}

/** Call the app API with the shared secret. */
export async function app(path, init = {}) {
	const { origin, secret } = config();

	if (!secret) {
		throw new WpError(
			'WP_SHARED_SECRET is not set. It must match APP_SHARED_SECRET on the WordPress resource.',
			500,
		);
	}

	const response = await fetch(`${origin}/wp-json/app/v1${path}`, {
		...init,
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
			'X-App-Secret': secret,
			...(init.headers ?? {}),
		},
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});

	return json(response, `app${path}`);
}

/** Read published content over WPGraphQL. */
export async function graphql(query, variables = {}) {
	const { endpoint } = config();

	const response = await fetch(endpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify({ query, variables }),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});

	const body = await json(response, 'graphql');

	if (body?.errors?.length) {
		throw new WpError(body.errors.map((e) => e.message).join('; '), 400);
	}

	return body?.data ?? {};
}

/** Core REST, for content writes. Needs an application password. */
export async function wpRest(path, init = {}) {
	const { origin, appPassword } = config();

	if (!appPassword) {
		throw new WpError(
			'Writing content needs WP_APPLICATION_PASSWORD, in the form "user:xxxx xxxx xxxx xxxx xxxx xxxx". ' +
				'Create one at wp-admin -> Users -> Profile -> Application Passwords. ' +
				'Lead tools work without it.',
			401,
		);
	}

	const response = await fetch(`${origin}/wp-json/wp/v2${path}`, {
		...init,
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
			Authorization: `Basic ${Buffer.from(appPassword, 'utf8').toString('base64')}`,
			...(init.headers ?? {}),
		},
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});

	return json(response, `wp/v2${path}`);
}
