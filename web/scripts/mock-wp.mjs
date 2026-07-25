#!/usr/bin/env node
/**
 * Mock WPGraphQL server.
 *
 * Serves a schema that mirrors what the mu-plugins in ../wordpress/mu-plugins
 * produce, backed by fixture content. Two uses:
 *
 *  1. Front-end work without Docker/WordPress running:
 *       node scripts/mock-wp.mjs &
 *       WP_GRAPHQL_ENDPOINT=http://localhost:8099/graphql npm run dev
 *
 *  2. A check that every query document in src/lib/wp/queries.ts is valid
 *     against the expected schema. Because queries are executed for real here,
 *     a typo'd field or a fragment on the wrong type fails loudly:
 *       node scripts/mock-wp.mjs --validate
 *
 * This is a stand-in for the schema, not a second source of truth: when you
 * change a Meta Box group in app-fields.php, update the SDL below to match.
 */

import { createServer } from 'node:http';
import { buildSchema, graphql, validate, parse } from 'graphql';
import {
	PAGES_QUERY,
	POSTS_QUERY,
	PROJECTS_QUERY,
	SERVICES_QUERY,
	TESTIMONIALS_QUERY,
	SITE_QUERY,
	MENU_QUERY,
} from '../src/lib/wp/queries.ts';

const PORT = Number(process.env.MOCK_WP_PORT ?? 8099);

/**
 * Origin this mock is served from.
 *
 * Real WordPress serves /graphql and the site's own permalinks from the same
 * origin, so fixture content links use this — that is what exercises the
 * internal-link rewriting in src/lib/wp/html.ts.
 */
const ORIGIN = `http://localhost:${PORT}`;

/*
 * Schema. Field-for-field with what app-graphql-metabox.php registers:
 * one object field per Meta Box group, media as AppMediaItem, post references
 * as AppPostRef, cloned fields as lists.
 */
const schema = buildSchema(/* GraphQL */ `
	type PageInfo {
		hasNextPage: Boolean!
		endCursor: String
	}

	type MediaDetails {
		width: Int
		height: Int
	}

	type MediaItem {
		sourceUrl: String
		altText: String
		title: String
		mediaDetails: MediaDetails
	}

	type FeaturedImageEdge {
		node: MediaItem
	}

	interface NodeWithFeaturedImage {
		featuredImage: FeaturedImageEdge
	}

	type AppMediaItem {
		databaseId: Int
		url: String
		alt: String
		title: String
		caption: String
		description: String
		width: Int
		height: Int
		srcset: String
		mimeType: String
	}

	type AppPostRef {
		databaseId: Int
		title: String
		slug: String
		uri: String
		postType: String
	}

	type AppSeo {
		title: String
		description: String
		noindex: Boolean
		image: AppMediaItem
	}

	type AppHero {
		eyebrow: String
		heading: String
		subheading: String
		ctaLabel: String
		ctaUrl: String
		image: AppMediaItem
	}

	type AppProjectDetails {
		client: String
		year: Int
		role: String
		summary: String
		deliverables: [String]
		url: String
		featured: Boolean
		hero: AppMediaItem
		gallery: [AppMediaItem]
	}

	type AppServiceDetails {
		tagline: String
		icon: String
		bullets: [String]
		startingPrice: String
	}

	type AppTestimonialDetails {
		quote: String
		author: String
		role: String
		company: String
		rating: String
		photo: AppMediaItem
		project: AppPostRef
	}

	type Term {
		name: String
		slug: String
	}

	type TermConnection {
		nodes: [Term]
	}

	type User {
		name: String
		slug: String
	}

	type UserEdge {
		node: User
	}

	type PageParentEdge {
		node: Page
	}

	type Page implements NodeWithFeaturedImage {
		databaseId: Int
		slug: String
		uri: String
		title: String
		content: String
		date: String
		modified: String
		frontendPath: String
		isFrontPage: Boolean
		parent: PageParentEdge
		featuredImage: FeaturedImageEdge
		seo: AppSeo
		hero: AppHero
	}

	type Post implements NodeWithFeaturedImage {
		databaseId: Int
		slug: String
		uri: String
		title: String
		content: String
		excerpt: String
		date: String
		modified: String
		frontendPath: String
		author: UserEdge
		categories: TermConnection
		tags: TermConnection
		featuredImage: FeaturedImageEdge
		seo: AppSeo
	}

	type Project implements NodeWithFeaturedImage {
		databaseId: Int
		slug: String
		uri: String
		title: String
		content: String
		excerpt: String
		date: String
		modified: String
		menuOrder: Int
		frontendPath: String
		capabilities: TermConnection
		industries: TermConnection
		featuredImage: FeaturedImageEdge
		seo: AppSeo
		projectDetails: AppProjectDetails
	}

	type Service implements NodeWithFeaturedImage {
		databaseId: Int
		slug: String
		uri: String
		title: String
		content: String
		excerpt: String
		date: String
		modified: String
		menuOrder: Int
		frontendPath: String
		capabilities: TermConnection
		featuredImage: FeaturedImageEdge
		seo: AppSeo
		serviceDetails: AppServiceDetails
	}

	type Testimonial {
		databaseId: Int
		slug: String
		title: String
		content: String
		date: String
		modified: String
		menuOrder: Int
		testimonialDetails: AppTestimonialDetails
	}

	type PageConnection {
		pageInfo: PageInfo
		nodes: [Page]
	}

	type PostConnection {
		pageInfo: PageInfo
		nodes: [Post]
	}

	type ProjectConnection {
		pageInfo: PageInfo
		nodes: [Project]
	}

	type ServiceConnection {
		pageInfo: PageInfo
		nodes: [Service]
	}

	type TestimonialConnection {
		pageInfo: PageInfo
		nodes: [Testimonial]
	}

	type GeneralSettings {
		title: String
		description: String
		url: String
	}

	type MenuItem {
		id: String
		label: String
		uri: String
		url: String
		target: String
		parentId: String
	}

	type MenuItemConnection {
		nodes: [MenuItem]
	}

	enum MenuLocationEnum {
		PRIMARY
		FOOTER
	}

	input MenuItemsWhere {
		location: MenuLocationEnum
	}

	type Query {
		pages(first: Int!, after: String): PageConnection
		posts(first: Int!, after: String): PostConnection
		projects(first: Int!, after: String): ProjectConnection
		services(first: Int!, after: String): ServiceConnection
		testimonials(first: Int!, after: String): TestimonialConnection
		generalSettings: GeneralSettings
		menuItems(where: MenuItemsWhere, first: Int): MenuItemConnection
	}
`);

/* ---------------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------------ */

const DONE = { hasNextPage: false, endCursor: null };

const image = (seed, width = 1600, height = 1200) => ({
	databaseId: seed,
	// picsum is only reachable when online; nothing in the build fetches these
	// URLs, they are only written into src attributes.
	url: `https://picsum.photos/seed/app${seed}/${width}/${height}`,
	alt: `Placeholder image ${seed}`,
	title: `Image ${seed}`,
	caption: seed % 2 === 0 ? 'A caption from the media library.' : '',
	description: '',
	width,
	height,
	srcset: `https://picsum.photos/seed/app${seed}/800/600 800w, https://picsum.photos/seed/app${seed}/${width}/${height} ${width}w`,
	mimeType: 'image/jpeg',
});

const noSeo = { title: null, description: null, noindex: false, image: null };

const pages = [
	{
		databaseId: 10,
		slug: 'home',
		uri: '/',
		title: 'Home',
		content:
			// The internal link, the wp-content link and the self-closing <img />
			// are all here on purpose: they cover every branch of transformContent.
			`<p>We are a small studio that builds <a href="${ORIGIN}/about/">brands</a> with backbone.</p>` +
			`<p>Here is <a href="${ORIGIN}/wp-content/uploads/2026/01/brief.pdf">a PDF</a> that must stay absolute, ` +
			'and <a href="https://example.com" target="_blank">an external link</a>.</p>' +
			'<h2>How we work</h2><p>Three people, one room, no account managers.</p>' +
			'<figure class="wp-block-image"><img src="https://picsum.photos/seed/appbody/1200/800" alt="Studio" /><figcaption>The studio.</figcaption></figure>',
		date: '2026-01-04T09:00:00',
		modified: '2026-06-01T09:00:00',
		frontendPath: '/',
		isFrontPage: true,
		parent: null,
		featuredImage: null,
		seo: { title: 'Your Studio', description: 'Brand and web studio.', noindex: false, image: image(901, 1200, 630) },
		hero: {
			eyebrow: 'Independent studio',
			heading: 'Brands that wear a bow tie.',
			subheading: 'Identity, websites and campaigns for people who sweat the details.',
			ctaLabel: 'See the work',
			ctaUrl: '/work',
			image: image(1, 1400, 1100),
		},
	},
	{
		databaseId: 11,
		slug: 'about',
		uri: '/about/',
		title: 'About',
		content: '<p>Founded in 2019. Still answering our own phones.</p><ul><li>Brand</li><li>Web</li></ul>',
		date: '2026-01-05T09:00:00',
		modified: '2026-02-05T09:00:00',
		frontendPath: '/about',
		isFrontPage: false,
		parent: null,
		featuredImage: { node: { sourceUrl: 'https://picsum.photos/seed/appabout/1400/900', altText: 'The team', title: 'Team', mediaDetails: { width: 1400, height: 900 } } },
		seo: noSeo,
		hero: { eyebrow: 'Who we are', heading: null, subheading: 'A studio of three.', ctaLabel: null, ctaUrl: null, image: null },
	},
	{
		databaseId: 12,
		slug: 'team',
		uri: '/about/team/',
		title: 'The Team',
		content: '<p>Ryan, Dana and a very opinionated cat.</p>',
		date: '2026-01-06T09:00:00',
		modified: null,
		frontendPath: '/about/team',
		isFrontPage: false,
		parent: { node: { slug: 'about' } },
		featuredImage: null,
		seo: noSeo,
		hero: null,
	},
	{
		databaseId: 13,
		slug: 'contact',
		uri: '/contact/',
		title: 'Contact',
		content: '<p>Email <a href="mailto:ryan@bowtiekreative.com">ryan@bowtiekreative.com</a>.</p>',
		date: '2026-01-07T09:00:00',
		modified: null,
		frontendPath: '/contact',
		isFrontPage: false,
		parent: null,
		featuredImage: null,
		seo: noSeo,
		hero: null,
	},
];

const posts = [
	{
		databaseId: 20,
		slug: 'why-headless',
		uri: '/why-headless/',
		title: 'Why we went headless',
		content: '<p>WordPress for editing, Astro for delivery.</p><blockquote><p>Editors should not need a deploy.</p></blockquote>',
		excerpt: '<p>WordPress for editing, Astro for delivery.</p>',
		date: '2026-05-12T10:00:00',
		modified: '2026-05-14T10:00:00',
		frontendPath: '/blog/why-headless',
		author: { node: { name: 'Ryan', slug: 'ryan' } },
		categories: { nodes: [{ name: 'Process', slug: 'process' }] },
		tags: { nodes: [{ name: 'Astro', slug: 'astro' }, { name: 'WordPress', slug: 'wordpress' }] },
		featuredImage: { node: { sourceUrl: 'https://picsum.photos/seed/apppost1/1400/900', altText: '', title: '', mediaDetails: { width: 1400, height: 900 } } },
		seo: noSeo,
	},
	{
		databaseId: 21,
		slug: 'type-crimes',
		uri: '/type-crimes/',
		title: 'Five type crimes we keep seeing',
		content: '<p>Starting with letter-spaced lowercase.</p>',
		excerpt: '',
		date: '2026-03-02T10:00:00',
		modified: null,
		frontendPath: '/blog/type-crimes',
		author: { node: { name: 'Dana', slug: 'dana' } },
		categories: { nodes: [{ name: 'Craft', slug: 'craft' }] },
		tags: { nodes: [] },
		featuredImage: null,
		seo: noSeo,
	},
];

const projects = [
	{
		databaseId: 30,
		slug: 'northside-coffee',
		uri: '/work/northside-coffee/',
		title: 'Northside Coffee Rebrand',
		content: '<p>A full identity refresh for a neighbourhood roaster.</p><h2>The problem</h2><p>Six logos, no system.</p>',
		excerpt: '',
		date: '2026-04-01T09:00:00',
		modified: null,
		menuOrder: 1,
		frontendPath: '/work/northside-coffee',
		capabilities: { nodes: [{ name: 'Brand Identity', slug: 'brand-identity' }, { name: 'Packaging', slug: 'packaging' }] },
		industries: { nodes: [{ name: 'Food & Drink', slug: 'food-drink' }] },
		featuredImage: null,
		seo: noSeo,
		projectDetails: {
			client: 'Northside Coffee',
			year: 2026,
			role: 'Brand identity, packaging, art direction',
			summary: 'One system, six touchpoints, zero committee meetings.',
			deliverables: ['Logo system', 'Packaging', 'Brand guidelines', ''],
			url: 'https://example.com',
			featured: true,
			hero: image(2, 1800, 1200),
			gallery: [image(3), image(4), image(5), image(6)],
		},
	},
	{
		databaseId: 31,
		slug: 'harbor-dental',
		uri: '/work/harbor-dental/',
		title: 'Harbor Dental Website',
		content: '<p>A calm, fast site for a practice that hates dentist-office clichés.</p>',
		excerpt: '<p>A calm, fast site.</p>',
		date: '2026-02-01T09:00:00',
		modified: null,
		menuOrder: 2,
		frontendPath: '/work/harbor-dental',
		capabilities: { nodes: [{ name: 'Web Design', slug: 'web-design' }] },
		industries: { nodes: [{ name: 'Healthcare', slug: 'healthcare' }] },
		featuredImage: { node: { sourceUrl: 'https://picsum.photos/seed/appharbor/1600/1200', altText: 'Harbor Dental', title: '', mediaDetails: { width: 1600, height: 1200 } } },
		seo: noSeo,
		// Deliberately empty: exercises the fallback to featuredImage and the
		// "no gallery" branch.
		projectDetails: {
			client: 'Harbor Dental',
			year: 2025,
			role: null,
			summary: null,
			deliverables: [],
			url: null,
			featured: false,
			hero: null,
			gallery: [],
		},
	},
	{
		databaseId: 32,
		slug: 'no-details',
		uri: '/work/no-details/',
		title: 'A project with no Meta Box data at all',
		content: '<p>Every custom field left blank.</p>',
		excerpt: '',
		date: '2026-01-01T09:00:00',
		modified: null,
		menuOrder: 3,
		frontendPath: '/work/no-details',
		capabilities: { nodes: [] },
		industries: { nodes: [] },
		featuredImage: null,
		seo: noSeo,
		projectDetails: null,
	},
];

const services = [
	{
		databaseId: 40,
		slug: 'brand-identity',
		uri: '/services/brand-identity/',
		title: 'Brand Identity',
		content: '<p>Logo systems, type, colour and the rules that hold them together.</p>',
		excerpt: '',
		date: '2026-01-02T09:00:00',
		modified: null,
		menuOrder: 1,
		frontendPath: '/services/brand-identity',
		capabilities: { nodes: [{ name: 'Brand Identity', slug: 'brand-identity' }] },
		featuredImage: null,
		seo: noSeo,
		serviceDetails: {
			tagline: 'A system, not just a logo.',
			icon: 'brand',
			bullets: ['Discovery workshop', 'Logo system', 'Type and colour', 'Guidelines'],
			startingPrice: 'from $6,500',
		},
	},
	{
		databaseId: 41,
		slug: 'web-design-build',
		uri: '/services/web-design-build/',
		title: 'Web Design & Build',
		content: '<p>Design and development on a modern, fast stack.</p>',
		excerpt: '',
		date: '2026-01-03T09:00:00',
		modified: null,
		menuOrder: 2,
		frontendPath: '/services/web-design-build',
		capabilities: { nodes: [{ name: 'Web Design', slug: 'web-design' }] },
		featuredImage: null,
		seo: noSeo,
		serviceDetails: { tagline: null, icon: 'web', bullets: [], startingPrice: null },
	},
];

const testimonials = [
	{
		databaseId: 50,
		slug: 'dana-northside',
		title: 'Dana at Northside',
		content: '<p>Body copy that should be ignored in favour of the quote field.</p>',
		date: '2026-04-10T09:00:00',
		modified: null,
		menuOrder: 1,
		testimonialDetails: {
			quote: 'They understood the brief better than we did.',
			author: 'Dana Reyes',
			role: 'Owner',
			company: 'Northside Coffee',
			rating: '5',
			photo: image(7, 400, 400),
			project: { databaseId: 30, title: 'Northside Coffee Rebrand', slug: 'northside-coffee', uri: '/work/northside-coffee/', postType: 'app_project' },
		},
	},
	{
		databaseId: 51,
		slug: 'quote-from-body',
		title: 'Anonymous',
		content: '<p>Fast, calm and on budget.</p>',
		date: '2026-04-11T09:00:00',
		modified: null,
		menuOrder: 2,
		// No quote field and no project: exercises the body-copy fallback.
		testimonialDetails: { quote: null, author: null, role: null, company: null, rating: null, photo: null, project: null },
	},
];

const root = {
	pages: () => ({ pageInfo: DONE, nodes: pages }),
	posts: () => ({ pageInfo: DONE, nodes: posts }),
	projects: () => ({ pageInfo: DONE, nodes: projects }),
	services: () => ({ pageInfo: DONE, nodes: services }),
	testimonials: () => ({ pageInfo: DONE, nodes: testimonials }),
	generalSettings: () => ({
		title: 'Your Studio',
		description: 'Brand, web and creative studio.',
		url: 'http://localhost:8080',
	}),
	menuItems: () => ({
		nodes: [
			{ id: 'm1', label: 'Work', uri: '/work/', url: null, target: null, parentId: null },
			{ id: 'm2', label: 'Services', uri: '/services/', url: null, target: null, parentId: null },
			{ id: 'm3', label: 'Journal', uri: '/blog/', url: null, target: null, parentId: null },
			{ id: 'm4', label: 'About', uri: '/about/', url: null, target: null, parentId: null },
			{ id: 'm5', label: 'Contact', uri: '/contact/', url: null, target: null, parentId: null },
		],
	}),
};

/* ---------------------------------------------------------------------------
 * --validate: check every query document against the schema
 * ------------------------------------------------------------------------ */

if (process.argv.includes('--validate')) {
	const documents = {
		PAGES_QUERY,
		POSTS_QUERY,
		PROJECTS_QUERY,
		SERVICES_QUERY,
		TESTIMONIALS_QUERY,
		SITE_QUERY,
		MENU_QUERY,
	};

	let failed = 0;

	for (const [name, source] of Object.entries(documents)) {
		try {
			const errors = validate(schema, parse(source));

			if (errors.length > 0) {
				failed++;
				console.error(`✗ ${name}`);
				for (const error of errors) {
					console.error(`    ${error.message}`);
				}
			} else {
				console.log(`✓ ${name}`);
			}
		} catch (error) {
			failed++;
			console.error(`✗ ${name} — could not parse: ${error.message}`);
		}
	}

	// Also execute them, which catches resolver/shape problems the static
	// validator cannot see.
	for (const [name, source] of Object.entries(documents)) {
		const result = await graphql({ schema, source, rootValue: root, variableValues: { first: 100, after: null } });

		if (result.errors?.length) {
			failed++;
			console.error(`✗ ${name} (execution)`);
			for (const error of result.errors) {
				console.error(`    ${error.message}`);
			}
		}
	}

	console.log(failed === 0 ? '\nAll query documents valid.' : `\n${failed} problem(s) found.`);
	process.exit(failed === 0 ? 0 : 1);
}

/* ---------------------------------------------------------------------------
 * Server
 * ------------------------------------------------------------------------ */

const server = createServer((req, res) => {
	const send = (status, payload) => {
		const body = JSON.stringify(payload);
		res.writeHead(status, {
			'Content-Type': 'application/json',
			'Content-Length': Buffer.byteLength(body),
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
			'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
		});
		res.end(body);
	};

	if (req.method === 'OPTIONS') {
		send(204, {});
		return;
	}

	if (req.method !== 'POST') {
		send(405, { errors: [{ message: 'Use POST.' }] });
		return;
	}

	let raw = '';
	req.on('data', (chunk) => {
		raw += chunk;
	});

	req.on('end', async () => {
		try {
			const { query, variables } = JSON.parse(raw || '{}');
			const result = await graphql({ schema, source: query, rootValue: root, variableValues: variables ?? {} });
			send(200, result);
		} catch (error) {
			send(400, { errors: [{ message: error.message }] });
		}
	});
});

server.listen(PORT, () => {
	console.log(`Mock WPGraphQL listening on http://localhost:${PORT}/graphql`);
	console.log(`Point the front end at it:  WP_GRAPHQL_ENDPOINT=http://localhost:${PORT}/graphql npm run dev`);
});
