/**
 * Collection schemas, plus the normalisers that flatten WPGraphQL's nested
 * response shape into them.
 *
 * Everything the pages touch is normalised here so components never have to
 * write `node.projectDetails?.hero?.url ?? node.featuredImage?.node?.sourceUrl`.
 * Dates are kept as ISO strings rather than Date objects: content-layer entries
 * are persisted as JSON between builds, and strings survive that round trip
 * without any coercion subtleties.
 */

import { z } from 'astro/zod';
import { excerpt, stripHtml, transformContent } from './html';

/* -------------------------------------------------------------------------
 * Shared shapes
 * ---------------------------------------------------------------------- */

export const mediaSchema = z.object({
	id: z.number().nullable(),
	url: z.string(),
	alt: z.string(),
	title: z.string(),
	caption: z.string(),
	width: z.number().nullable(),
	height: z.number().nullable(),
	srcset: z.string().nullable(),
	mimeType: z.string().nullable(),
});

export const termSchema = z.object({
	name: z.string(),
	slug: z.string(),
});

export const seoSchema = z.object({
	title: z.string().nullable(),
	description: z.string().nullable(),
	image: mediaSchema.nullable(),
	noindex: z.boolean(),
});

export type Media = z.infer<typeof mediaSchema>;
export type Term = z.infer<typeof termSchema>;
export type Seo = z.infer<typeof seoSchema>;

/* -------------------------------------------------------------------------
 * Raw GraphQL shapes (only the parts we read)
 * ---------------------------------------------------------------------- */

interface GqlMedia {
	databaseId?: number | null;
	url?: string | null;
	alt?: string | null;
	title?: string | null;
	caption?: string | null;
	width?: number | null;
	height?: number | null;
	srcset?: string | null;
	mimeType?: string | null;
}

interface GqlFeaturedImage {
	featuredImage?: {
		node?: {
			sourceUrl?: string | null;
			altText?: string | null;
			title?: string | null;
			mediaDetails?: { width?: number | null; height?: number | null } | null;
		} | null;
	} | null;
}

interface GqlTermConnection {
	nodes?: Array<{ name?: string | null; slug?: string | null }> | null;
}

interface GqlSeo {
	title?: string | null;
	description?: string | null;
	noindex?: boolean | null;
	image?: GqlMedia | null;
}

interface GqlBase extends GqlFeaturedImage {
	databaseId?: number | null;
	slug?: string | null;
	uri?: string | null;
	title?: string | null;
	content?: string | null;
	excerpt?: string | null;
	date?: string | null;
	modified?: string | null;
	menuOrder?: number | null;
	frontendPath?: string | null;
	seo?: GqlSeo | null;
}

/* -------------------------------------------------------------------------
 * Normalisers
 * ---------------------------------------------------------------------- */

function text(value: string | null | undefined): string {
	return typeof value === 'string' ? value : '';
}

function int(value: number | null | undefined): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function normalizeMedia(media: GqlMedia | null | undefined): Media | null {
	if (!media?.url) {
		return null;
	}

	return {
		id: int(media.databaseId),
		url: media.url,
		alt: text(media.alt),
		title: text(media.title),
		caption: stripHtml(media.caption),
		width: int(media.width),
		height: int(media.height),
		srcset: media.srcset ?? null,
		mimeType: media.mimeType ?? null,
	};
}

export function normalizeMediaList(list: Array<GqlMedia | null> | null | undefined): Media[] {
	if (!Array.isArray(list)) {
		return [];
	}

	return list.map(normalizeMedia).filter((item): item is Media => item !== null);
}

/** WordPress's own featured image, mapped into our media shape. */
function normalizeFeaturedImage(node: GqlFeaturedImage): Media | null {
	const image = node.featuredImage?.node;

	if (!image?.sourceUrl) {
		return null;
	}

	return {
		id: null,
		url: image.sourceUrl,
		alt: text(image.altText),
		title: text(image.title),
		caption: '',
		width: int(image.mediaDetails?.width),
		height: int(image.mediaDetails?.height),
		srcset: null,
		mimeType: null,
	};
}

function normalizeTerms(connection: GqlTermConnection | null | undefined): Term[] {
	if (!Array.isArray(connection?.nodes)) {
		return [];
	}

	return connection.nodes
		.filter((term): term is { name: string; slug: string } => Boolean(term?.name && term?.slug))
		.map((term) => ({ name: term.name, slug: term.slug }));
}

function normalizeSeo(seo: GqlSeo | null | undefined, fallbackDescription: string): Seo {
	return {
		title: seo?.title || null,
		description: seo?.description || fallbackDescription || null,
		image: normalizeMedia(seo?.image),
		noindex: Boolean(seo?.noindex),
	};
}

/** Clone fields come back as arrays that may contain empty strings. */
function normalizeStringList(list: Array<string | null> | null | undefined): string[] {
	if (!Array.isArray(list)) {
		return [];
	}

	return list.map((item) => text(item).trim()).filter((item) => item !== '');
}

/* -------------------------------------------------------------------------
 * Collections
 * ---------------------------------------------------------------------- */

const baseFields = {
	databaseId: z.number(),
	slug: z.string(),
	title: z.string(),
	path: z.string(),
	summary: z.string(),
	date: z.string().nullable(),
	modified: z.string().nullable(),
	featuredImage: mediaSchema.nullable(),
	seo: seoSchema,
};

export const pageSchema = z.object({
	...baseFields,
	uri: z.string(),
	isFrontPage: z.boolean(),
	hero: z
		.object({
			eyebrow: z.string().nullable(),
			heading: z.string().nullable(),
			subheading: z.string().nullable(),
			ctaLabel: z.string().nullable(),
			ctaUrl: z.string().nullable(),
			image: mediaSchema.nullable(),
		})
		.nullable(),
});

export const postSchema = z.object({
	...baseFields,
	author: z.string().nullable(),
	categories: z.array(termSchema),
	tags: z.array(termSchema),
});

export const projectSchema = z.object({
	...baseFields,
	menuOrder: z.number(),
	client: z.string().nullable(),
	year: z.number().nullable(),
	role: z.string().nullable(),
	deliverables: z.array(z.string()),
	externalUrl: z.string().nullable(),
	featured: z.boolean(),
	hero: mediaSchema.nullable(),
	gallery: z.array(mediaSchema),
	capabilities: z.array(termSchema),
	industries: z.array(termSchema),
});

export const serviceSchema = z.object({
	...baseFields,
	menuOrder: z.number(),
	tagline: z.string().nullable(),
	icon: z.string().nullable(),
	bullets: z.array(z.string()),
	startingPrice: z.string().nullable(),
	capabilities: z.array(termSchema),
});

export const testimonialSchema = z.object({
	databaseId: z.number(),
	slug: z.string(),
	title: z.string(),
	menuOrder: z.number(),
	quote: z.string(),
	author: z.string().nullable(),
	role: z.string().nullable(),
	company: z.string().nullable(),
	rating: z.number().nullable(),
	photo: mediaSchema.nullable(),
	project: z
		.object({
			databaseId: z.number().nullable(),
			title: z.string().nullable(),
			slug: z.string().nullable(),
			path: z.string().nullable(),
		})
		.nullable(),
});

/* -------------------------------------------------------------------------
 * Entry builders — GraphQL node → { id, data, html }
 * ---------------------------------------------------------------------- */

export interface BuiltEntry {
	id: string;
	data: Record<string, unknown>;
	html: string;
}

/** Entries are keyed by slug, which is what every route uses. */
function requireSlug(node: GqlBase): string | null {
	const slug = text(node.slug).trim();

	return slug === '' ? null : slug;
}

function common(node: GqlBase, fallbackPath: string) {
	const summary = node.excerpt ? stripHtml(node.excerpt) : excerpt(node.content, 200);

	return {
		databaseId: int(node.databaseId) ?? 0,
		slug: text(node.slug),
		title: stripHtml(node.title) || text(node.slug),
		path: text(node.frontendPath) || fallbackPath,
		summary,
		date: node.date ?? null,
		modified: node.modified ?? null,
		featuredImage: normalizeFeaturedImage(node),
		seo: normalizeSeo(node.seo, summary),
	};
}

export function buildPage(node: GqlBase & {
	isFrontPage?: boolean | null;
	hero?: {
		eyebrow?: string | null;
		heading?: string | null;
		subheading?: string | null;
		ctaLabel?: string | null;
		ctaUrl?: string | null;
		image?: GqlMedia | null;
	} | null;
}): BuiltEntry | null {
	const slug = requireSlug(node);

	if (!slug) {
		return null;
	}

	const uri = text(node.uri) || `/${slug}/`;
	const hero = node.hero;
	// A group with every field empty is noise; treat it as absent.
	const hasHero = Boolean(
		hero && (hero.eyebrow || hero.heading || hero.subheading || hero.ctaLabel || hero.image?.url),
	);

	return {
		id: slug,
		data: {
			...common(node, uri),
			uri,
			isFrontPage: Boolean(node.isFrontPage),
			hero: hasHero
				? {
						eyebrow: hero?.eyebrow || null,
						heading: hero?.heading || null,
						subheading: hero?.subheading || null,
						ctaLabel: hero?.ctaLabel || null,
						ctaUrl: hero?.ctaUrl || null,
						image: normalizeMedia(hero?.image),
					}
				: null,
		},
		html: transformContent(node.content),
	};
}

export function buildPost(node: GqlBase & {
	author?: { node?: { name?: string | null } | null } | null;
	categories?: GqlTermConnection | null;
	tags?: GqlTermConnection | null;
}): BuiltEntry | null {
	const slug = requireSlug(node);

	if (!slug) {
		return null;
	}

	return {
		id: slug,
		data: {
			...common(node, `/blog/${slug}`),
			author: node.author?.node?.name || null,
			categories: normalizeTerms(node.categories),
			tags: normalizeTerms(node.tags),
		},
		html: transformContent(node.content),
	};
}

export function buildProject(node: GqlBase & {
	capabilities?: GqlTermConnection | null;
	industries?: GqlTermConnection | null;
	projectDetails?: {
		client?: string | null;
		year?: number | null;
		role?: string | null;
		summary?: string | null;
		deliverables?: Array<string | null> | null;
		url?: string | null;
		featured?: boolean | null;
		hero?: GqlMedia | null;
		gallery?: Array<GqlMedia | null> | null;
	} | null;
}): BuiltEntry | null {
	const slug = requireSlug(node);

	if (!slug) {
		return null;
	}

	const details = node.projectDetails;
	const base = common(node, `/work/${slug}`);
	// The hand-written summary wins over an auto-generated excerpt.
	const summary = details?.summary ? stripHtml(details.summary) : base.summary;

	return {
		id: slug,
		data: {
			...base,
			summary,
			seo: { ...base.seo, description: base.seo.description || summary || null },
			menuOrder: int(node.menuOrder) ?? 0,
			client: details?.client || null,
			year: int(details?.year),
			role: details?.role || null,
			deliverables: normalizeStringList(details?.deliverables),
			externalUrl: details?.url || null,
			featured: Boolean(details?.featured),
			hero: normalizeMedia(details?.hero) ?? base.featuredImage,
			gallery: normalizeMediaList(details?.gallery),
			capabilities: normalizeTerms(node.capabilities),
			industries: normalizeTerms(node.industries),
		},
		html: transformContent(node.content),
	};
}

export function buildService(node: GqlBase & {
	capabilities?: GqlTermConnection | null;
	serviceDetails?: {
		tagline?: string | null;
		icon?: string | null;
		bullets?: Array<string | null> | null;
		startingPrice?: string | null;
	} | null;
}): BuiltEntry | null {
	const slug = requireSlug(node);

	if (!slug) {
		return null;
	}

	const details = node.serviceDetails;

	return {
		id: slug,
		data: {
			...common(node, `/services/${slug}`),
			menuOrder: int(node.menuOrder) ?? 0,
			tagline: details?.tagline || null,
			icon: details?.icon || null,
			bullets: normalizeStringList(details?.bullets),
			startingPrice: details?.startingPrice || null,
			capabilities: normalizeTerms(node.capabilities),
		},
		html: transformContent(node.content),
	};
}

export function buildTestimonial(node: GqlBase & {
	testimonialDetails?: {
		quote?: string | null;
		author?: string | null;
		role?: string | null;
		company?: string | null;
		rating?: string | null;
		photo?: GqlMedia | null;
		project?: {
			databaseId?: number | null;
			title?: string | null;
			slug?: string | null;
			uri?: string | null;
			postType?: string | null;
		} | null;
	} | null;
}): BuiltEntry | null {
	const slug = requireSlug(node);

	if (!slug) {
		return null;
	}

	const details = node.testimonialDetails;
	// Fall back to the editor body so a testimonial entered the obvious way
	// still renders even if the Quote field was left empty.
	const quote = stripHtml(details?.quote) || stripHtml(node.content);

	if (quote === '') {
		return null;
	}

	const rating = Number.parseInt(text(details?.rating), 10);
	const project = details?.project;

	return {
		id: slug,
		data: {
			databaseId: int(node.databaseId) ?? 0,
			slug,
			title: stripHtml(node.title) || slug,
			menuOrder: int(node.menuOrder) ?? 0,
			quote,
			author: details?.author || null,
			role: details?.role || null,
			company: details?.company || null,
			rating: Number.isFinite(rating) ? rating : null,
			photo: normalizeMedia(details?.photo),
			project: project?.slug
				? {
						databaseId: int(project.databaseId),
						title: project.title || null,
						slug: project.slug,
						path: `/work/${project.slug}`,
					}
				: null,
		},
		html: transformContent(node.content),
	};
}
