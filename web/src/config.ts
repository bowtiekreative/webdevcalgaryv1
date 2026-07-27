/**
 * Single place for anything brand- or deployment-specific.
 *
 * This exists so the boilerplate can be reused without grepping for a studio
 * name across components. Values fall back to WordPress's own General Settings
 * where that makes sense (see lib/wp/site.ts) — this file only supplies the
 * defaults used before WordPress answers, and things WordPress has no opinion
 * about (nav labels, dashboard copy, plan definitions).
 */

function env(key: string, fallback: string): string {
	const value =
		(import.meta.env as Record<string, string | undefined>)[key] ??
		(typeof process !== 'undefined' ? process.env?.[key] : undefined);

	return value === undefined || value === '' ? fallback : value;
}

export const site = {
	/** Shown in the header, <title> suffix, RSS and social tags. */
	name: env('SITE_NAME', 'Your Studio'),
	/** One-line description, used when WordPress has no tagline set. */
	tagline: env('SITE_TAGLINE', 'Brand, web and creative studio.'),
	/** Public URL. Also set `site` in astro.config.mjs from the same variable. */
	url: env('SITE_URL', 'http://localhost:4321'),
	/** Mark shown before the name in the header. */
	mark: env('SITE_MARK', '✦'),
	/** Where "contact us" style links point. */
	contactPath: '/contact',
} as const;

/** Fallback navigation, used until a menu is assigned to PRIMARY in WordPress. */
export const fallbackNav = [
	{ label: 'Work', href: '/work' },
	{ label: 'Services', href: '/services' },
	{ label: 'Journal', href: '/blog' },
	{ label: 'About', href: '/about' },
	{ label: 'Contact', href: '/contact' },
] as const;

/**
 * Subscription plans offered in the dashboard.
 *
 * Provider ids are referenced by *key name* rather than value, because they can
 * come from either web/.env or Settings → App Settings in wp-admin. Resolve
 * them with `planProviderIds()`, which applies that precedence. A plan whose
 * ids are unset is still shown, with its buttons disabled and an explanation —
 * it does not fail at the Checkout call.
 */
export interface Plan {
	/** Stable internal key, stored on the WordPress user. */
	id: string;
	name: string;
	/** Display price, e.g. "$29". Purely cosmetic — the provider is authoritative. */
	price: string;
	interval: 'month' | 'year';
	description: string;
	features: string[];
	/** Setting key holding the Stripe price id, e.g. STRIPE_PRICE_STARTER. */
	stripePriceKey: string;
	/** Setting key holding the PayPal plan id. */
	paypalPlanKey: string;
	/** Highlighted in the pricing table. */
	featured?: boolean;
}

export const plans: Plan[] = [
	{
		id: 'starter',
		name: 'Starter',
		price: '$29',
		interval: 'month',
		description: 'For a single brand and one sender domain.',
		features: ['1 brand workspace', '2,500 emails / month', 'Email support'],
		stripePriceKey: 'STRIPE_PRICE_STARTER',
		paypalPlanKey: 'PAYPAL_PLAN_STARTER',
	},
	{
		id: 'studio',
		name: 'Studio',
		price: '$79',
		interval: 'month',
		description: 'For agencies running campaigns for several clients.',
		features: ['5 brand workspaces', '25,000 emails / month', 'Campaign scheduling', 'Priority support'],
		stripePriceKey: 'STRIPE_PRICE_STUDIO',
		paypalPlanKey: 'PAYPAL_PLAN_STUDIO',
		featured: true,
	},
];

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

export function findPlan(id: string | null | undefined): Plan | null {
	return plans.find((plan) => plan.id === id) ?? null;
}

/** Roles recognised by the dashboard, most privileged first. */
export const ROLE_ADMIN = 'administrator';
export const ROLE_MEMBER = 'subscriber';
