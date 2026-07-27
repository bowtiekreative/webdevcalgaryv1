/**
 * Configuration resolver: environment first, WordPress second.
 *
 * Every key can come from two places:
 *
 *   1. An environment variable in web/.env — always wins. Not in the database,
 *      not in backups, not readable by anyone holding a WordPress admin
 *      session. This is where production secrets belong.
 *   2. Settings → App Settings in wp-admin — so a key can be added or rotated
 *      without a redeploy.
 *
 * The WordPress side is fetched once and memoised for a short window. A
 * dashboard request that needs three keys makes at most one settings call, and
 * a key rotated in wp-admin takes effect within the TTL without a restart.
 */

const TTL_MS = 30_000;

/** env name -> WordPress option key. */
const KEY_MAP: Record<string, string> = {
	STRIPE_SECRET_KEY: 'stripe_secret_key',
	STRIPE_WEBHOOK_SECRET: 'stripe_webhook_secret',
	STRIPE_PRICE_CORE: 'stripe_price_core',
	STRIPE_PRICE_GROWTH: 'stripe_price_growth',
	PAYPAL_ENV: 'paypal_env',
	PAYPAL_CLIENT_ID: 'paypal_client_id',
	PAYPAL_CLIENT_SECRET: 'paypal_client_secret',
	PAYPAL_WEBHOOK_ID: 'paypal_webhook_id',
	PAYPAL_PLAN_CORE: 'paypal_plan_core',
	PAYPAL_PLAN_GROWTH: 'paypal_plan_growth',
	EMAILIT_API_KEY: 'emailit_api_key',
	EMAILIT_FROM: 'emailit_from',
	EMAILIT_RATE_LIMIT: 'emailit_rate_limit',
};

export function envValue(key: string): string {
	const value =
		(import.meta.env as Record<string, string | undefined>)[key] ??
		(typeof process !== 'undefined' ? process.env?.[key] : undefined);

	return (value ?? '').trim();
}

interface Cache {
	values: Record<string, string>;
	fetchedAt: number;
}

let cache: Cache | null = null;
let inFlight: Promise<Record<string, string>> | null = null;

function apiBase(): string {
	const endpoint = envValue('WP_GRAPHQL_ENDPOINT') || 'http://localhost:8080/graphql';

	try {
		return `${new URL(endpoint).origin}/wp-json/app/v1`;
	} catch {
		return 'http://localhost:8080/wp-json/app/v1';
	}
}

async function fetchStoredSettings(): Promise<Record<string, string>> {
	const secret = envValue('WP_SHARED_SECRET');

	// Without the shared secret there is no way to read them; env-only is a
	// perfectly valid way to run, so this is not an error.
	if (!secret) {
		return {};
	}

	try {
		const response = await fetch(`${apiBase()}/settings`, {
			headers: { Accept: 'application/json', 'X-App-Secret': secret },
			signal: AbortSignal.timeout(8_000),
		});

		if (!response.ok) {
			return {};
		}

		const payload = (await response.json()) as { settings?: Record<string, string> };

		return payload.settings ?? {};
	} catch {
		// WordPress down: fall back to env only rather than breaking the page.
		return {};
	}
}

/** Stored settings, memoised. Concurrent callers share one request. */
async function storedSettings(): Promise<Record<string, string>> {
	if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
		return cache.values;
	}

	inFlight ??= fetchStoredSettings()
		.then((values) => {
			cache = { values, fetchedAt: Date.now() };

			return values;
		})
		.finally(() => {
			inFlight = null;
		});

	return inFlight;
}

/**
 * Resolve one setting: env if present, else WordPress, else the fallback.
 */
export async function setting(key: keyof typeof KEY_MAP | string, fallback = ''): Promise<string> {
	const fromEnv = envValue(key);

	if (fromEnv) {
		return fromEnv;
	}

	const optionKey = KEY_MAP[key];

	if (!optionKey) {
		return fallback;
	}

	const stored = (await storedSettings())[optionKey] ?? '';

	return stored || fallback;
}

/** True when a setting has a usable value from either source. */
export async function hasSetting(key: string): Promise<boolean> {
	return (await setting(key)).length > 0;
}

/** Drop the memoised copy — used after something changes it. */
export function clearSettingsCache(): void {
	cache = null;
}

/* -------------------------------------------------------------------------
 * Site mode
 * ---------------------------------------------------------------------- */

export type SiteMode = 'live' | 'coming_soon' | 'maintenance';

export interface SiteModeState {
	mode: SiteMode;
	heading: string;
	message: string;
	until: string;
	allowIps: string[];
}

const LIVE: SiteModeState = { mode: 'live', heading: '', message: '', until: '', allowIps: [] };

let modeCache: { value: SiteModeState; fetchedAt: number } | null = null;
let modeInFlight: Promise<SiteModeState> | null = null;

/**
 * Current site mode.
 *
 * Checked on every public request, so it is cached briefly and fails open:
 * if WordPress is unreachable we serve the site rather than showing everyone a
 * maintenance page because the CMS blipped.
 *
 * `SITE_MODE` in the environment overrides WordPress entirely, which is how you
 * put the site into maintenance when WordPress itself is the thing that is
 * down.
 */
export async function siteMode(): Promise<SiteModeState> {
	const forced = envValue('SITE_MODE');

	if (forced === 'coming_soon' || forced === 'maintenance') {
		return {
			...LIVE,
			mode: forced,
			heading: envValue('SITE_MODE_HEADING'),
			message: envValue('SITE_MODE_MESSAGE'),
		};
	}

	if (forced === 'live') {
		return LIVE;
	}

	const ttl = Number(envValue('SITE_MODE_TTL_MS') || 15_000);

	if (modeCache && Date.now() - modeCache.fetchedAt < ttl) {
		return modeCache.value;
	}

	const secret = envValue('WP_SHARED_SECRET');

	if (!secret) {
		return LIVE;
	}

	modeInFlight ??= (async (): Promise<SiteModeState> => {
		try {
			const response = await fetch(`${apiBase()}/site-mode`, {
				headers: { Accept: 'application/json', 'X-App-Secret': secret },
				signal: AbortSignal.timeout(5_000),
			});

			if (!response.ok) {
				return LIVE;
			}

			const payload = (await response.json()) as Partial<SiteModeState>;
			const mode = payload.mode;

			return {
				mode: mode === 'coming_soon' || mode === 'maintenance' ? mode : 'live',
				heading: payload.heading ?? '',
				message: payload.message ?? '',
				until: payload.until ?? '',
				allowIps: Array.isArray(payload.allowIps) ? payload.allowIps : [],
			};
		} catch {
			return LIVE;
		}
	})()
		.then((value) => {
			modeCache = { value, fetchedAt: Date.now() };

			return value;
		})
		.finally(() => {
			modeInFlight = null;
		});

	return modeInFlight;
}
