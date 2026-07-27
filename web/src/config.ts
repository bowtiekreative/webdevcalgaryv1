/**
 * Single place for anything brand-, offer- or deployment-specific.
 *
 * Prices and copy here are the source of truth for the funnel: the landing
 * page, the checkout summary and the PayPal order that actually gets charged
 * all read the same numbers, so they cannot drift apart.
 *
 * Values fall back to WordPress's General Settings where that makes sense (see
 * lib/wp/site.ts) — this file supplies the defaults used before WordPress
 * answers, plus things WordPress has no opinion about.
 */

function env(key: string, fallback: string): string {
	const value =
		(import.meta.env as Record<string, string | undefined>)[key] ??
		(typeof process !== 'undefined' ? process.env?.[key] : undefined);

	return value === undefined || value === '' ? fallback : value;
}

export const site = {
	/** Shown in the header, <title> suffix, RSS and social tags. */
	name: env('SITE_NAME', 'WebDevCalgary'),
	/** One-line description, used when WordPress has no tagline set. */
	tagline: env('SITE_TAGLINE', 'Websites live in 24 hours. Unlimited changes. Price locked for life.'),
	/** Public URL. Also set `site` in astro.config.mjs from the same variable. */
	url: env('SITE_URL', 'https://webdevcalgary.com'),
	/** Rendered as "WebDev" + accented "Calgary" in the wordmark. */
	wordmark: { lead: 'WebDev', accent: 'Calgary' },
	/**
	 * Glyph shown before the name in the dashboard and login chrome, which do
	 * not use the full wordmark. The dispatch dot, so those screens still read
	 * as the same system.
	 */
	mark: env('SITE_MARK', '●'),
	contactPath: '/#start',
} as const;

/** Everything a visitor might use to reach a human. */
export const contact = {
	phone: env('SITE_PHONE', '(888) 755-0507'),
	/** tel:/sms: hrefs — digits only. */
	phoneRaw: env('SITE_PHONE_RAW', '8887550507'),
	/**
	 * Public contact address, shown on the site and used as Reply-To.
	 *
	 * Not the same as EMAILIT_FROM: Emailit sends from the verified
	 * bowtiekreative.com domain, and replies come back here. Once
	 * webdevcalgary.com is verified in Emailit too, the two can converge.
	 */
	email: env('SITE_EMAIL', 'hello@webdevcalgary.com'),
	company: 'Bow Tie Kreative',
	address: '2012 1st NW, Calgary AB',
	/** Where the offer is sold. Used in FAQ copy and local SEO. */
	serviceArea: ['Calgary', 'Airdrie', 'Okotoks', 'Cochrane', 'Chestermere', 'Strathmore'],
} as const;

/** Currency every price on the site and in PayPal is denominated in. */
export const CURRENCY = 'CAD';

/**
 * Fallback navigation, used until a menu is assigned to PRIMARY in WordPress.
 *
 * Deliberately short. This is a funnel, not a brochure — every extra nav item
 * is another way to leave without starting.
 */
export const fallbackNav = [
	{ label: 'Portfolio', href: '/work' },
	{ label: 'Pricing', href: '/#pricing' },
	{ label: 'Teardown', href: '/teardown' },
] as const;

/* -------------------------------------------------------------------------
 * Recurring plans — the business. Charged as PayPal subscriptions.
 * ---------------------------------------------------------------------- */

export interface Plan {
	/** Stable internal key, stored on the WordPress user and in order records. */
	id: string;
	name: string;
	/** Work-order serial, shown in the mono header bar. */
	serial: string;
	/** Display price, e.g. "$147". The provider is authoritative for billing. */
	price: string;
	/** Numeric equivalent, for the checkout summary. */
	amount: number;
	interval: 'month' | 'year';
	description: string;
	features: string[];
	/** Setting key holding the PayPal plan id (P-...). */
	paypalPlanKey: string;
	/** Setting key holding the Stripe price id. Stripe is wired but unused. */
	stripePriceKey: string;
	featured?: boolean;
}

export const plans: Plan[] = [
	{
		id: 'core',
		name: 'Core',
		serial: 'WC-100',
		price: '$147',
		amount: 147,
		interval: 'month',
		description: 'Unlimited changes, hosting, security. You own everything. Price locked for life.',
		features: [
			'Unlimited changes, 48h turnaround',
			'Hosting, SSL and domain handled',
			'Backups, security, uptime monitoring',
			'You own the site and the domain',
			'Price locked for life',
		],
		paypalPlanKey: 'PAYPAL_PLAN_CORE',
		stripePriceKey: 'STRIPE_PRICE_CORE',
	},
	{
		id: 'growth',
		name: 'Growth',
		serial: 'WC-200',
		price: '$497',
		amount: 497,
		interval: 'month',
		description: 'Core plus Google Business Profile, local SEO, review automation, AI-search visibility.',
		features: [
			'Everything in Core',
			'Google Business Profile managed',
			'Local SEO for Calgary searches',
			'Review requests on autopilot',
			'Built to be found in AI search',
			'Monthly report, plain English',
		],
		paypalPlanKey: 'PAYPAL_PLAN_GROWTH',
		stripePriceKey: 'STRIPE_PRICE_GROWTH',
		featured: true,
	},
];

export function findPlan(id: string | null | undefined): Plan | null {
	return plans.find((plan) => plan.id === id) ?? null;
}

/* -------------------------------------------------------------------------
 * One-time offers — the ladder from 02-offer-ladder.md.
 *
 * Charged through the PayPal Orders API rather than Subscriptions. `id` is
 * what the checkout posts and what the order endpoint prices, so the browser
 * can never name its own amount.
 * ---------------------------------------------------------------------- */

export interface Offer {
	id: string;
	name: string;
	/** What appears on the PayPal receipt. */
	description: string;
	amount: number;
	serial: string;
}

export const offers = {
	rush: {
		id: 'rush',
		name: '24-hour rush fee',
		description: 'Website live within 24 hours — refunded in full if we miss the window.',
		amount: 497,
		serial: 'WC-RUSH',
	},
	'rush-split': {
		id: 'rush-split',
		name: '24-hour rush fee (1 of 2 payments)',
		description: 'First of two $249 payments. Second charged on day 30.',
		amount: 249,
		serial: 'WC-RUSH-2',
	},
	teardown: {
		id: 'teardown',
		name: '24-Hour Website Teardown',
		description: 'Recorded walkthrough of your site and Google listing, plus a one-page fix list.',
		amount: 47,
		serial: 'WC-047',
	},
	gbp: {
		id: 'gbp',
		name: 'Google Business Profile Rescue',
		description: 'Categories, services, photos, hours and posting fixed. One time, not monthly.',
		amount: 97,
		serial: 'WC-GBP',
	},
	rescue: {
		id: 'rescue',
		name: 'Website Rescue',
		description: 'Keep your site — we fix the five things costing you the most.',
		amount: 297,
		serial: 'WC-297',
	},
} satisfies Record<string, Offer>;

export function findOffer(id: string | null | undefined): Offer | null {
	if (!id || !Object.hasOwn(offers, id)) {
		return null;
	}

	return offers[id as keyof typeof offers];
}

/** Standard build: same site, same plan, no rush fee — the price downsell. */
export const STANDARD_BUILD_DAYS = 7;

/** Hours on the hero clock, and the window the guarantee is written against. */
export const RUSH_WINDOW_HOURS = 24;

/**
 * Orders placed after this hour (Mountain Time) start the next business day.
 * The guarantee copy and the clock both derive from it.
 */
export const RUSH_CUTOFF_HOUR_MT = 14;

/** IANA zone the guarantee is written in. */
export const TIMEZONE = 'America/Edmonton';

/**
 * Resolve a plan's provider ids from env or WordPress.
 *
 * Imported lazily to keep this module free of server-only code — config.ts is
 * also read by prerendered marketing pages.
 */
export async function planProviderIds(plan: Plan): Promise<{
	stripePriceId: string | null;
	paypalPlanId: string | null;
}> {
	const { setting } = await import('./lib/settings');

	const [stripePriceId, paypalPlanId] = await Promise.all([
		setting(plan.stripePriceKey),
		setting(plan.paypalPlanKey),
	]);

	return {
		stripePriceId: stripePriceId || null,
		paypalPlanId: paypalPlanId || null,
	};
}

/** Roles recognised by the dashboard, most privileged first. */
export const ROLE_ADMIN = 'administrator';
export const ROLE_MEMBER = 'subscriber';
