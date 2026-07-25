/**
 * RSS feed for the journal.
 *
 * Only summaries are published, not full post HTML — shipping the WordPress
 * body would mean sanitising it first (@astrojs/rss requires `sanitize-html`
 * for that), and a summary plus a link is the friendlier feed anyway.
 */

import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { byDateDesc } from '../lib/routes';
import { getSiteMeta } from '../lib/wp/site';

export const GET: APIRoute = async (context) => {
	const posts = (await getCollection('posts')).sort(byDateDesc);
	const meta = await getSiteMeta();

	// `site` is set in astro.config.mjs, so context.site is always defined here;
	// the fallback keeps TypeScript happy without a non-null assertion.
	const site = context.site ?? new URL('http://localhost:4321');

	return rss({
		title: `${meta.title} — Journal`,
		description: meta.description,
		site,
		// Match astro.config's trailingSlash: 'never' so feed links don't redirect.
		trailingSlash: false,
		items: posts.map((post) => ({
			title: post.data.title,
			description: post.data.summary,
			link: post.data.path,
			pubDate: post.data.date ? new Date(post.data.date) : undefined,
			categories: post.data.categories.map((category) => category.name),
		})),
		customData: '<language>en</language>',
	});
};
