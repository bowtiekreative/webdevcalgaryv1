/**
 * Site-wide data that is not a content collection: the primary menu and
 * WordPress's general settings.
 *
 * Both are memoised at module scope, so they are fetched once per build no
 * matter how many pages read them. Both degrade to sensible defaults if
 * WordPress is unreachable or nothing is configured — navigation is not worth
 * failing a build over.
 */

import { MENU_QUERY, SITE_QUERY } from './queries';
import { wpQuery } from './client';
import { fallbackNav, site } from '../../config';

export interface NavItem {
	label: string;
	href: string;
	external: boolean;
}

export interface SiteMeta {
	title: string;
	description: string;
}

const FALLBACK_NAV: NavItem[] = fallbackNav.map((item) => ({ ...item, external: false }));

const FALLBACK_META: SiteMeta = {
	title: site.name,
	description: site.tagline,
};

interface MenuItemNode {
	label?: string | null;
	uri?: string | null;
	url?: string | null;
	parentId?: string | null;
}

let navPromise: Promise<NavItem[]> | null = null;
let metaPromise: Promise<SiteMeta> | null = null;

/**
 * Primary navigation, from the WordPress menu assigned to the PRIMARY location.
 *
 * Falls back to a hard-coded list when no menu is assigned, which is also what
 * a fresh install looks like.
 */
export function getPrimaryNav(): Promise<NavItem[]> {
	navPromise ??= (async () => {
		try {
			const data = await wpQuery<{ menuItems?: { nodes?: MenuItemNode[] | null } | null }>(
				MENU_QUERY,
				{},
				{ label: 'primary menu', attempts: 2 },
			);

			const items = (data.menuItems?.nodes ?? [])
				// Only top-level items; this design has no dropdowns.
				.filter((item) => !item.parentId)
				.map((item) => {
					const uri = item.uri?.trim();
					const url = item.url?.trim();
					const href = uri || url || '';

					return {
						label: (item.label ?? '').trim(),
						href: href.replace(/\/$/, '') || '/',
						external: /^https?:\/\//i.test(href) && !uri,
					};
				})
				.filter((item) => item.label !== '' && item.href !== '');

			return items.length > 0 ? items : FALLBACK_NAV;
		} catch {
			// A missing PRIMARY menu location is a schema error, not an outage —
			// either way the fallback is correct.
			return FALLBACK_NAV;
		}
	})();

	return navPromise;
}

export function getSiteMeta(): Promise<SiteMeta> {
	metaPromise ??= (async () => {
		try {
			const data = await wpQuery<{
				generalSettings?: { title?: string | null; description?: string | null } | null;
			}>(SITE_QUERY, {}, { label: 'site meta', attempts: 2 });

			return {
				title: data.generalSettings?.title?.trim() || FALLBACK_META.title,
				description: data.generalSettings?.description?.trim() || FALLBACK_META.description,
			};
		} catch {
			return FALLBACK_META;
		}
	})();

	return metaPromise;
}
