/**
 * Content collections, all sourced from headless WordPress over WPGraphQL.
 *
 * Query these anywhere with getCollection('projects') / getEntry('pages', slug)
 * and render the WordPress HTML with `const { Content } = await render(entry)`.
 */

import { defineCollection } from 'astro:content';
import { wpLoader } from './lib/wp/loader';
import {
	PAGES_QUERY,
	POSTS_QUERY,
	PROJECTS_QUERY,
	SERVICES_QUERY,
	TESTIMONIALS_QUERY,
} from './lib/wp/queries';
import {
	buildPage,
	buildPost,
	buildProject,
	buildService,
	buildTestimonial,
	pageSchema,
	postSchema,
	projectSchema,
	serviceSchema,
	testimonialSchema,
} from './lib/wp/schema';

const pages = defineCollection({
	loader: wpLoader({
		label: 'pages',
		query: PAGES_QUERY,
		select: (data) => data?.pages,
		build: buildPage,
	}),
	schema: pageSchema,
});

const posts = defineCollection({
	loader: wpLoader({
		label: 'posts',
		query: POSTS_QUERY,
		select: (data) => data?.posts,
		build: buildPost,
	}),
	schema: postSchema,
});

const projects = defineCollection({
	loader: wpLoader({
		label: 'projects',
		query: PROJECTS_QUERY,
		select: (data) => data?.projects,
		build: buildProject,
	}),
	schema: projectSchema,
});

const services = defineCollection({
	loader: wpLoader({
		label: 'services',
		query: SERVICES_QUERY,
		select: (data) => data?.services,
		build: buildService,
	}),
	schema: serviceSchema,
});

const testimonials = defineCollection({
	loader: wpLoader({
		label: 'testimonials',
		query: TESTIMONIALS_QUERY,
		select: (data) => data?.testimonials,
		build: buildTestimonial,
	}),
	schema: testimonialSchema,
});

export const collections = { pages, posts, projects, services, testimonials };
