/**
 * Route helpers shared by the page files.
 */

import type { CollectionEntry } from 'astro:content';

/**
 * Paths owned by files in src/pages, which the WordPress page catch-all must
 * not also try to generate.
 *
 * Astro prefers a static route over a rest param, so a collision would not
 * break the build — it would just silently drop the WordPress page. Excluding
 * them explicitly keeps that from being a mystery.
 */
export const RESERVED_SLUGS = new Set(['work', 'services', 'blog', 'rss.xml', '404']);

/**
 * menu_order first (that's what the drag handles in wp-admin set), then newest.
 *
 * `date` is optional so this also works for testimonials, which are only ever
 * ordered by hand.
 */
export function byMenuOrderThenDate<T extends { data: { menuOrder: number; date?: string | null } }>(
	a: T,
	b: T,
): number {
	if (a.data.menuOrder !== b.data.menuOrder) {
		return a.data.menuOrder - b.data.menuOrder;
	}

	return dateValue(b.data.date) - dateValue(a.data.date);
}

/** Newest first. */
export function byDateDesc<T extends { data: { date?: string | null } }>(a: T, b: T): number {
	return dateValue(b.data.date) - dateValue(a.data.date);
}

function dateValue(value: string | null | undefined): number {
	if (!value) {
		return 0;
	}

	const time = Date.parse(value);

	return Number.isNaN(time) ? 0 : time;
}

/** Human date, e.g. "15 January 2026". Returns null for missing/invalid input. */
export function formatDate(value: string | null | undefined): string | null {
	if (!value) {
		return null;
	}

	const date = new Date(value);

	if (Number.isNaN(date.getTime())) {
		return null;
	}

	return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** ISO date for <time datetime>. */
export function isoDate(value: string | null | undefined): string | undefined {
	if (!value) {
		return undefined;
	}

	const date = new Date(value);

	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Featured projects, falling back to the most recent ones. */
export function pickFeatured(
	projects: Array<CollectionEntry<'projects'>>,
	limit = 3,
): Array<CollectionEntry<'projects'>> {
	const featured = projects.filter((project) => project.data.featured);

	return (featured.length > 0 ? featured : projects).slice(0, limit);
}
