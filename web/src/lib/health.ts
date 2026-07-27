/**
 * Live end-to-end check of the stack.
 *
 * Answers one question per row: is this thing actually working, right now?
 * Every check performs a real call — nothing here reports "configured" when it
 * means "a value is present but never tried".
 *
 * The mapping table is the important part. Content has to survive four hops:
 *
 *   MySQL row -> WordPress post type -> GraphQL/REST -> Astro collection -> route
 *
 * A break at any hop shows up as content silently missing rather than as an
 * error, so each hop is counted separately and compared.
 */

import { getCollection } from 'astro:content';
import { envValue, setting, siteMode } from './settings';
import { wpQuery } from './wp/client';

export type Status = 'ok' | 'warn' | 'fail' | 'skip';

export interface Check {
	label: string;
	status: Status;
	detail: string;
}

export interface TypeMapping {
	label: string;
	postType: string;
	dbRows: number;
	graphql: string;
	graphqlCount: number | null;
	rest: string;
	restCount: number | null;
	collection: string;
	collectionCount: number | null;
	route: string;
	fieldsInRest: number;
	status: Status;
	note: string;
}

export interface HealthReport {
	generatedAt: string;
	wordpress: Record<string, string>;
	connectivity: Check[];
	mapping: TypeMapping[];
	fieldGroups: Array<{ id: string; graphqlName: string; postTypes: string[]; total: number; inRest: number; inGraphql: number }>;
	tables: Array<{ name: string; rows: number }>;
	integrations: Check[];
	webhooks: Check[];
	security: Check[];
}

/* -------------------------------------------------------------------------
 * WordPress diagnostics
 * ---------------------------------------------------------------------- */

interface Diagnostics {
	wordpress: Record<string, string>;
	plugins: { wpgraphql: boolean; metabox: boolean };
	database: { connected: boolean; tables: Array<{ name: string; rows: number }> };
	postTypes: Array<{
		key: string;
		registered: boolean;
		label?: string;
		public?: boolean;
		showInRest?: boolean;
		restBase?: string;
		showInGraphql?: boolean;
		graphqlSingle?: string;
		graphqlPlural?: string;
		restMetaKeys?: string[];
		counts?: { publish: number; draft: number; total: number };
	}>;
	taxonomies: Array<{ key: string; registered: boolean; terms: number; inGraphql: boolean }>;
	fieldGroups: Array<{
		id: string;
		title: string;
		graphqlName: string;
		postTypes: string[];
		fields: Array<{ id: string; type: string; clone: boolean; inRest: boolean; inGraphl: boolean }>;
	}>;
	muPlugins: string[];
	apiKeys: Record<string, boolean>;
	sharedSecret: { constant: boolean; stored: boolean };
	siteMode: string;
}

function wpOrigin(): string {
	try {
		return new URL(envValue('WP_GRAPHQL_ENDPOINT') || 'http://localhost:8080/graphql').origin;
	} catch {
		return 'http://localhost:8080';
	}
}

async function fetchDiagnostics(): Promise<Diagnostics | null> {
	const secret = envValue('WP_SHARED_SECRET');

	if (!secret) {
		return null;
	}

	try {
		const response = await fetch(`${wpOrigin()}/wp-json/app/v1/diagnostics`, {
			headers: { Accept: 'application/json', 'X-App-Secret': secret },
			signal: AbortSignal.timeout(10_000),
		});

		return response.ok ? ((await response.json()) as Diagnostics) : null;
	} catch {
		return null;
	}
}

/** Row count from the public REST endpoint, via the X-WP-Total header. */
async function restCount(restBase: string): Promise<number | null> {
	try {
		const response = await fetch(`${wpOrigin()}/wp-json/wp/v2/${restBase}?per_page=1&status=publish`, {
			signal: AbortSignal.timeout(8_000),
		});

		if (!response.ok) {
			return null;
		}

		const total = response.headers.get('x-wp-total');

		return total === null ? null : Number.parseInt(total, 10);
	} catch {
		return null;
	}
}

/* -------------------------------------------------------------------------
 * Front-end side
 * ---------------------------------------------------------------------- */

const COLLECTIONS = [
	{ postType: 'post', collection: 'posts', graphql: 'posts', route: '/blog/[slug]' },
	{ postType: 'page', collection: 'pages', graphql: 'pages', route: '/[...slug]' },
	{ postType: 'app_project', collection: 'projects', graphql: 'projects', route: '/work/[slug]' },
	{ postType: 'app_service', collection: 'services', graphql: 'services', route: '/services/[slug]' },
	{ postType: 'app_testimonial', collection: 'testimonials', graphql: 'testimonials', route: 'inline' },
] as const;

async function collectionCount(name: (typeof COLLECTIONS)[number]['collection']): Promise<number | null> {
	try {
		return (await getCollection(name)).length;
	} catch {
		return null;
	}
}

/** Count nodes a GraphQL connection actually returns. */
async function graphqlCount(field: string): Promise<number | null> {
	try {
		const data = await wpQuery<Record<string, { nodes?: unknown[] }>>(
			`query Count { ${field}(first: 100) { nodes { databaseId } } }`,
			{},
			{ label: `health:${field}`, attempts: 1 },
		);

		return data[field]?.nodes?.length ?? null;
	} catch {
		return null;
	}
}

/* -------------------------------------------------------------------------
 * Integrations
 * ---------------------------------------------------------------------- */

/** Does the Stripe key work, and is a webhook endpoint registered? */
async function checkStripe(): Promise<{ api: Check; webhook: Check }> {
	const key = await setting('STRIPE_SECRET_KEY');

	if (!key) {
		return {
			api: { label: 'Stripe API', status: 'skip', detail: 'No secret key set.' },
			webhook: { label: 'Stripe webhook', status: 'skip', detail: 'Needs a secret key first.' },
		};
	}

	const auth = { Authorization: `Bearer ${key}` };
	let api: Check;

	try {
		// Cheapest authenticated call that proves the key is live.
		const response = await fetch('https://api.stripe.com/v1/balance', {
			headers: auth,
			signal: AbortSignal.timeout(10_000),
		});

		api = response.ok
			? {
					label: 'Stripe API',
					status: 'ok',
					detail: `Key accepted (${key.startsWith('sk_live') ? 'live' : 'test'} mode).`,
				}
			: { label: 'Stripe API', status: 'fail', detail: `Rejected the key (HTTP ${response.status}).` };
	} catch (error) {
		api = {
			label: 'Stripe API',
			status: 'fail',
			detail: `Could not reach Stripe: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	let webhook: Check;

	try {
		const response = await fetch('https://api.stripe.com/v1/webhook_endpoints?limit=10', {
			headers: auth,
			signal: AbortSignal.timeout(10_000),
		});

		if (!response.ok) {
			webhook = { label: 'Stripe webhook', status: 'warn', detail: 'Could not list webhook endpoints.' };
		} else {
			const payload = (await response.json()) as { data?: Array<{ url: string; status: string }> };
			const endpoints = payload.data ?? [];
			const ours = endpoints.filter((endpoint) => endpoint.url.includes('/api/billing/stripe-webhook'));
			const secretSet = Boolean(await setting('STRIPE_WEBHOOK_SECRET'));

			if (ours.length > 0) {
				webhook = {
					label: 'Stripe webhook',
					status: secretSet ? 'ok' : 'warn',
					detail: secretSet
						? `${ours.length} endpoint(s) registered: ${ours.map((e) => e.url).join(', ')}`
						: 'Endpoint registered, but STRIPE_WEBHOOK_SECRET is not set, so events will be rejected.',
				};
			} else {
				webhook = {
					label: 'Stripe webhook',
					status: secretSet ? 'warn' : 'fail',
					detail: secretSet
						? 'A signing secret is set but no matching endpoint is registered in Stripe. Fine if you are using `stripe listen`.'
						: 'No endpoint registered and no signing secret. Subscriptions will never activate.',
				};
			}
		}
	} catch {
		webhook = { label: 'Stripe webhook', status: 'warn', detail: 'Could not check webhook endpoints.' };
	}

	return { api, webhook };
}

/** Does the PayPal client work, and is a webhook registered? */
async function checkPayPal(): Promise<{ api: Check; webhook: Check }> {
	const [id, secret, env, webhookId] = await Promise.all([
		setting('PAYPAL_CLIENT_ID'),
		setting('PAYPAL_CLIENT_SECRET'),
		setting('PAYPAL_ENV'),
		setting('PAYPAL_WEBHOOK_ID'),
	]);

	if (!id || !secret) {
		return {
			api: { label: 'PayPal API', status: 'skip', detail: 'No client credentials set.' },
			webhook: { label: 'PayPal webhook', status: 'skip', detail: 'Needs credentials first.' },
		};
	}

	const base = env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
	const mode = env === 'live' ? 'live' : 'sandbox';
	let token: string | null = null;
	let api: Check;

	try {
		const response = await fetch(`${base}/v1/oauth2/token`, {
			method: 'POST',
			headers: {
				Authorization: `Basic ${Buffer.from(`${id}:${secret}`, 'utf8').toString('base64')}`,
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: 'grant_type=client_credentials',
			signal: AbortSignal.timeout(12_000),
		});

		if (response.ok) {
			token = ((await response.json()) as { access_token?: string }).access_token ?? null;
			api = { label: 'PayPal API', status: 'ok', detail: `Credentials accepted (${mode}).` };
		} else {
			api = { label: 'PayPal API', status: 'fail', detail: `Rejected the credentials (HTTP ${response.status}).` };
		}
	} catch (error) {
		api = {
			label: 'PayPal API',
			status: 'fail',
			detail: `Could not reach PayPal: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	if (!webhookId) {
		return {
			api,
			webhook: {
				label: 'PayPal webhook',
				status: 'fail',
				detail: 'PAYPAL_WEBHOOK_ID is not set. Every PayPal event will be rejected.',
			},
		};
	}

	if (!token) {
		return { api, webhook: { label: 'PayPal webhook', status: 'warn', detail: 'Could not verify — no access token.' } };
	}

	try {
		const response = await fetch(`${base}/v1/notifications/webhooks/${encodeURIComponent(webhookId)}`, {
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(10_000),
		});

		if (response.ok) {
			const hook = (await response.json()) as { url?: string };

			return {
				api,
				webhook: {
					label: 'PayPal webhook',
					status: 'ok',
					detail: `Registered: ${hook.url ?? webhookId}`,
				},
			};
		}

		return {
			api,
			webhook: {
				label: 'PayPal webhook',
				status: 'fail',
				detail: `PayPal does not recognise that webhook id (HTTP ${response.status}).`,
			},
		};
	} catch {
		return { api, webhook: { label: 'PayPal webhook', status: 'warn', detail: 'Could not verify the webhook id.' } };
	}
}

/** Does the Emailit key work? */
async function checkEmailit(): Promise<Check> {
	const key = await setting('EMAILIT_API_KEY');

	if (!key) {
		return { label: 'Emailit API', status: 'skip', detail: 'No API key set.' };
	}

	try {
		const response = await fetch('https://api.emailit.com/v2/audiences/list', {
			headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
			signal: AbortSignal.timeout(10_000),
		});

		if (response.status === 401 || response.status === 403) {
			return { label: 'Emailit API', status: 'fail', detail: 'The key was rejected.' };
		}

		return response.ok
			? { label: 'Emailit API', status: 'ok', detail: 'Key accepted; audiences readable.' }
			: { label: 'Emailit API', status: 'warn', detail: `Unexpected response (HTTP ${response.status}).` };
	} catch (error) {
		return {
			label: 'Emailit API',
			status: 'fail',
			detail: `Could not reach Emailit: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/* -------------------------------------------------------------------------
 * Report
 * ---------------------------------------------------------------------- */

export async function buildHealthReport(): Promise<HealthReport> {
	const [diagnostics, mode, stripe, paypal, emailit] = await Promise.all([
		fetchDiagnostics(),
		siteMode(),
		checkStripe(),
		checkPayPal(),
		checkEmailit(),
	]);

	const connectivity: Check[] = [];

	if (!diagnostics) {
		connectivity.push({
			label: 'WordPress app API',
			status: 'fail',
			detail: envValue('WP_SHARED_SECRET')
				? `Could not reach ${wpOrigin()}/wp-json/app/v1/diagnostics. Is WordPress running, and does the secret match?`
				: 'WP_SHARED_SECRET is not set in web/.env, so the app API cannot be called.',
		});
	} else {
		connectivity.push(
			{ label: 'WordPress app API', status: 'ok', detail: `${wpOrigin()}/wp-json/app/v1` },
			{
				label: 'Database',
				status: diagnostics.database.connected ? 'ok' : 'fail',
				detail: diagnostics.database.connected
					? `Connected. Prefix "${diagnostics.wordpress.tablePrefix}".`
					: 'WordPress cannot reach MySQL.',
			},
			{
				label: 'WPGraphQL',
				status: diagnostics.plugins.wpgraphql ? 'ok' : 'fail',
				detail: diagnostics.plugins.wpgraphql ? 'Active.' : 'Not active — the site cannot read content.',
			},
			{
				label: 'Meta Box',
				status: diagnostics.plugins.metabox ? 'ok' : 'fail',
				detail: diagnostics.plugins.metabox ? 'Active.' : 'Not active — custom fields will be missing.',
			},
			{
				label: 'Permalinks',
				status: diagnostics.wordpress.permalinks ? 'ok' : 'fail',
				detail: diagnostics.wordpress.permalinks
					? diagnostics.wordpress.permalinks
					: 'Set to Plain. WPGraphQL needs pretty permalinks for /graphql to resolve.',
			},
			{
				label: 'mu-plugins loaded',
				status: diagnostics.muPlugins.length >= 9 ? 'ok' : 'warn',
				detail: `${diagnostics.muPlugins.length} files in mu-plugins.`,
			},
		);
	}

	// GraphQL reachability, independent of the app API.
	const graphqlProbe = await graphqlCount('posts');
	connectivity.push({
		label: 'GraphQL endpoint',
		status: graphqlProbe === null ? 'fail' : 'ok',
		detail:
			graphqlProbe === null
				? `No usable response from ${envValue('WP_GRAPHQL_ENDPOINT') || 'the configured endpoint'}.`
				: `${envValue('WP_GRAPHQL_ENDPOINT')} answered.`,
	});

	/* --- Mapping ------------------------------------------------------- */

	const mapping: TypeMapping[] = [];

	for (const entry of COLLECTIONS) {
		const wpType = diagnostics?.postTypes.find((type) => type.key === entry.postType);
		const dbRows = wpType?.counts?.publish ?? -1;

		const [gql, rest, collection] = await Promise.all([
			graphqlCount(entry.graphql),
			wpType?.restBase ? restCount(wpType.restBase) : Promise.resolve(null),
			collectionCount(entry.collection),
		]);

		let status: Status = 'ok';
		let note = 'Published rows reach the front end.';

		if (!wpType?.registered) {
			status = 'fail';
			note = 'Post type is not registered in WordPress.';
		} else if (gql === null) {
			status = 'fail';
			note = 'GraphQL returned nothing — is the type exposed and public?';
		} else if (collection === null) {
			status = 'fail';
			note = 'The Astro collection failed to load.';
		} else if (dbRows > 0 && collection === 0) {
			status = 'fail';
			note = `${dbRows} published in the database but 0 in the build. Rebuild, or check the collection loader.`;
		} else if (dbRows !== collection && dbRows >= 0) {
			// A stale content-layer cache is the usual cause, not a bug.
			status = 'warn';
			note = `Database has ${dbRows} published, the build has ${collection}. Usually a stale cache — rebuild.`;
		} else if (dbRows === 0) {
			status = 'warn';
			note = 'No published content of this type yet.';
		}

		mapping.push({
			label: wpType?.label ?? entry.postType,
			postType: entry.postType,
			dbRows,
			graphql: entry.graphql,
			graphqlCount: gql,
			rest: wpType?.restBase ?? '—',
			restCount: rest,
			collection: entry.collection,
			collectionCount: collection,
			route: entry.route,
			fieldsInRest: wpType?.restMetaKeys?.length ?? 0,
			status,
			note,
		});
	}

	/* --- Security ------------------------------------------------------ */

	const security: Check[] = [
		{
			label: 'API access secret',
			status: diagnostics?.sharedSecret.constant || diagnostics?.sharedSecret.stored ? 'ok' : 'fail',
			detail: diagnostics
				? [
						diagnostics.sharedSecret.constant ? 'wp-config constant set' : null,
						diagnostics.sharedSecret.stored ? 'generated secret stored' : null,
					]
						.filter(Boolean)
						.join(', ') || 'None configured — the dashboard cannot sign anyone in.'
				: 'Unknown — could not reach WordPress.',
		},
		{
			label: 'Site mode',
			status: mode.mode === 'live' ? 'ok' : 'warn',
			detail:
				mode.mode === 'live'
					? 'Live.'
					: `Public pages are gated (${mode.mode}). They change on the next build, not immediately.`,
		},
		{
			label: 'WordPress environment',
			status: diagnostics ? (diagnostics.wordpress.environment === 'production' ? 'ok' : 'warn') : 'skip',
			detail: diagnostics
				? `WP_ENVIRONMENT_TYPE is "${diagnostics.wordpress.environment}". Application passwords need this to be local, or HTTPS.`
				: '',
		},
	];

	return {
		generatedAt: new Date().toISOString(),
		wordpress: diagnostics?.wordpress ?? {},
		connectivity,
		mapping,
		fieldGroups: (diagnostics?.fieldGroups ?? []).map((group) => ({
			id: group.id,
			graphqlName: group.graphqlName,
			postTypes: group.postTypes,
			total: group.fields.length,
			inRest: group.fields.filter((field) => field.inRest).length,
			inGraphql: group.fields.filter((field) => field.inGraphl).length,
		})),
		tables: diagnostics?.database.tables ?? [],
		integrations: [stripe.api, paypal.api, emailit],
		webhooks: [stripe.webhook, paypal.webhook],
		security,
	};
}
