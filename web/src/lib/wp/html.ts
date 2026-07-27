/**
 * Build-time HTML tidying for WordPress content.
 *
 * These are regex transforms rather than a DOM parse. That is a deliberate
 * trade-off: this only ever runs at build time over content produced by the
 * WordPress editor, the patterns are anchored to attributes the editor emits,
 * and adding a parser dependency to rewrite two attributes is not worth it. If
 * you start doing structural rewrites (unwrapping blocks, moving nodes) swap
 * this for `node-html-parser` — the function boundaries here won't change.
 */

import { getEndpoint } from './client';

/** Origin of the WordPress install, derived from the GraphQL endpoint. */
function wpOrigin(): string | null {
	try {
		return new URL(getEndpoint()).origin;
	} catch {
		return null;
	}
}

/** Paths that must keep pointing at WordPress even though they share its origin. */
const WP_OWNED_PATHS = ['/wp-content/', '/wp-includes/', '/wp-admin/', '/wp-json/', '/graphql'];

/**
 * Rewrite links that point back at WordPress so they stay inside the Astro site.
 *
 * Media and admin URLs are left absolute — the files really do live on the
 * WordPress host.
 */
function rewriteInternalLinks(html: string, origin: string): string {
	return html.replace(
		/(<a\b[^>]*?\bhref=")([^"]+)(")/gi,
		(match, prefix: string, href: string, suffix: string) => {
			if (!href.startsWith(origin)) {
				return match;
			}

			const path = href.slice(origin.length) || '/';

			if (WP_OWNED_PATHS.some((owned) => path.startsWith(owned))) {
				return match;
			}

			// WordPress permalinks carry a trailing slash; the site is built with
			// trailingSlash: 'never', so normalise to match and avoid a redirect.
			const normalized = path.replace(/^([^?#]*[^/?#])\/(?=$|[?#])/, '$1');

			return `${prefix}${normalized}${suffix}`;
		},
	);
}

/**
 * Add lazy-loading hints to images that don't already carry them.
 *
 * The `\s*\/?` before the closing bracket matters: the block editor emits
 * self-closing `<img ... />`, and without it the trailing slash ends up
 * captured as part of the attribute list, producing `alt="x" / loading="lazy"`.
 */
function lazyLoadImages(html: string): string {
	return html.replace(/<img\b([^>]*?)\s*\/?>/gi, (_match, attrs: string) => {
		let out = attrs;

		if (!/\bloading=/i.test(out)) {
			out += ' loading="lazy"';
		}

		if (!/\bdecoding=/i.test(out)) {
			out += ' decoding="async"';
		}

		return `<img${out} />`;
	});
}

/** Make `target="_blank"` links safe. */
function hardenExternalLinks(html: string): string {
	return html.replace(/<a\b([^>]*\btarget="_blank"[^>]*)>/gi, (match, attrs: string) => {
		if (/\brel=/i.test(attrs)) {
			return match;
		}

		return `<a${attrs} rel="noopener noreferrer">`;
	});
}

/**
 * Prepare WordPress `content` HTML for rendering.
 */
export function transformContent(html: string | null | undefined): string {
	if (!html) {
		return '';
	}

	let out = html;
	const origin = wpOrigin();

	if (origin) {
		out = rewriteInternalLinks(out, origin);
	}

	out = lazyLoadImages(out);
	out = hardenExternalLinks(out);

	return out;
}

const HTML_ENTITIES: Record<string, string> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#039;': "'",
	'&#39;': "'",
	'&apos;': "'",
	'&nbsp;': ' ',
	'&hellip;': '…',
	'&mdash;': '—',
	'&ndash;': '–',
	'&rsquo;': '’',
	'&lsquo;': '‘',
	'&ldquo;': '“',
	'&rdquo;': '”',
};

/** Turn HTML into plain text, for meta descriptions and card copy. */
export function stripHtml(html: string | null | undefined): string {
	if (!html) {
		return '';
	}

	return html
		.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&[a-z#0-9]+;/gi, (entity) => HTML_ENTITIES[entity.toLowerCase()] ?? ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Plain-text excerpt, truncated on a word boundary.
 */
export function excerpt(html: string | null | undefined, maxLength = 200): string {
	const text = stripHtml(html);

	if (text.length <= maxLength) {
		return text;
	}

	const clipped = text.slice(0, maxLength);
	const lastSpace = clipped.lastIndexOf(' ');

	return `${clipped.slice(0, lastSpace > 40 ? lastSpace : clipped.length).trimEnd()}…`;
}
