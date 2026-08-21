/**
 * Single place for anything brand-, offer- or deployment-specific.
 *
 * Prices and copy here are the source of truth for the funnel, and so is the
 * definition of a qualified lead — the form, the score and the wp-admin queue
 * all read the same constants, so they cannot drift apart.
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
 * Recurring plans — the business.
 *
 * Shown so the page can say the number out loud, which the voice rules insist
 * on. Nothing here is charged on the site: the plan is agreed on the call.
 * ---------------------------------------------------------------------- */

export interface Plan {
	/** Stable internal key, stored on the WordPress user and in order records. */
	id: string;
	name: string;
	/** Work-order serial, shown in the mono header bar. */
	serial: string;
	/** Display price, e.g. "$147". */
	price: string;
	/** Numeric equivalent, for sorting and for the qualification budget bands. */
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
 * Lead qualification.
 *
 * This funnel does not take money. Nothing is sold self-serve — the page's job
 * is to get a qualified conversation started, and everything below is what
 * "qualified" means, expressed once so the form, the score and the wp-admin
 * queue cannot disagree about it.
 *
 * The weights are a first pass and deliberately blunt. Replace them with real
 * numbers after the first fifty leads: the point of scoring is to sort a queue,
 * not to be right about any individual.
 * ---------------------------------------------------------------------- */

export interface Choice {
	id: string;
	label: string;
	/** Contribution to the qualification score. */
	weight: number;
}

/** How soon they want it. The strongest single signal of intent. */
export const timelines: Choice[] = [
	{ id: 'asap', label: 'As soon as possible — this week', weight: 30 },
	{ id: 'month', label: 'Within the month', weight: 22 },
	{ id: 'quarter', label: 'Next few months', weight: 10 },
	{ id: 'exploring', label: 'Just looking for now', weight: 0 },
];

/** Monthly budget. Bands, not a free-text number — people round anyway. */
export const budgets: Choice[] = [
	{ id: 'growth', label: '$497/mo — the works, including Google and SEO', weight: 30 },
	{ id: 'core', label: '$147/mo — website, hosting, unlimited changes', weight: 24 },
	{ id: 'unsure', label: 'Not sure yet — tell me what it costs', weight: 14 },
	{ id: 'under', label: 'Under $100/mo', weight: 4 },
];

/** Whether we are talking to the person who decides. */
export const roles: Choice[] = [
	{ id: 'owner', label: 'I own the business', weight: 20 },
	{ id: 'partner', label: "I'm a partner or manager", weight: 14 },
	{ id: 'staff', label: 'I look after the website', weight: 6 },
	{ id: 'other', label: 'Something else', weight: 3 },
];

/** Where they are starting from. */
export const siteStates: Choice[] = [
	{ id: 'stale', label: "I have one, but it's out of date", weight: 15 },
	{ id: 'none', label: "I don't have a website", weight: 12 },
	{ id: 'broken', label: "I have one and it doesn't work properly", weight: 15 },
	{ id: 'fine', label: "I have one and it's fine", weight: 5 },
];

/**
 * The trades this offer is built for. Anything outside the list still gets a
 * callback — it just does not get the in-market bonus.
 */
export const trades: Choice[] = [
	{ id: 'hvac', label: 'HVAC', weight: 15 },
	{ id: 'plumbing', label: 'Plumbing', weight: 15 },
	{ id: 'electrical', label: 'Electrical', weight: 15 },
	{ id: 'roofing', label: 'Roofing', weight: 15 },
	{ id: 'landscaping', label: 'Landscaping & snow', weight: 15 },
	{ id: 'concrete', label: 'Concrete', weight: 15 },
	{ id: 'renovation', label: 'Renovation', weight: 15 },
	{ id: 'garage-doors', label: 'Garage doors', weight: 15 },
	{ id: 'dental', label: 'Dental', weight: 12 },
	{ id: 'med-spa', label: 'Med spa', weight: 12 },
	{ id: 'law', label: 'Law', weight: 12 },
	{ id: 'accounting', label: 'Accounting', weight: 12 },
	{ id: 'auto-repair', label: 'Auto repair', weight: 15 },
	{ id: 'restaurant', label: 'Restaurant', weight: 10 },
	{ id: 'other', label: 'Something else', weight: 5 },
];

/** Highest score achievable, used to normalise to 0-100. */
export const MAX_SCORE =
	Math.max(...timelines.map((c) => c.weight)) +
	Math.max(...budgets.map((c) => c.weight)) +
	Math.max(...roles.map((c) => c.weight)) +
	Math.max(...siteStates.map((c) => c.weight)) +
	Math.max(...trades.map((c) => c.weight));

/** Score bands. `hot` gets called the same day. */
export const GRADE_HOT = 70;
export const GRADE_WARM = 45;

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
