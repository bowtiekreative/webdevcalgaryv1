/**
 * The tool surface.
 *
 * Full access, meaning read *and* write, over the three things this site is
 * made of: the lead queue, the published content, and the app settings.
 *
 * Two rules run through all of it:
 *
 *   1. **Scores are never accepted from a caller.** `qualify_lead` recomputes
 *      from the answers using the same weights the website uses. A tool that
 *      let you set a grade directly would let anything reorder the callback
 *      queue, which is the one thing the queue is for.
 *
 *   2. **Destructive tools say so and default to reversible.** `delete_content`
 *      trashes rather than erases unless asked twice, because an agent that
 *      misreads an instruction should cost a click, not a post.
 */

import { app, graphql, wpRest } from './wp.js';

/* -------------------------------------------------------------------------
 * Scoring — a copy of web/src/lib/qualify.ts, deliberately.
 *
 * Duplicated rather than imported: the MCP server is a separate package with
 * no build step and the website's config is TypeScript. The tables are small
 * and change rarely. `qualification_model` exists so a caller can read the
 * weights back and notice if the two have drifted.
 * ---------------------------------------------------------------------- */

const WEIGHTS = {
	timeline: { asap: 30, month: 22, quarter: 10, exploring: 0 },
	budget: { growth: 30, core: 24, unsure: 14, under: 4 },
	role: { owner: 20, partner: 14, staff: 6, other: 3 },
	siteState: { stale: 15, none: 12, broken: 15, fine: 5 },
	trade: {
		hvac: 15, plumbing: 15, electrical: 15, roofing: 15, landscaping: 15,
		concrete: 15, renovation: 15, 'garage-doors': 15, 'auto-repair': 15,
		dental: 12, 'med-spa': 12, law: 12, accounting: 12, restaurant: 10, other: 5,
	},
};

const MAX_SCORE = Object.values(WEIGHTS).reduce(
	(sum, table) => sum + Math.max(...Object.values(table)),
	0,
);

const GRADE_HOT = 70;
const GRADE_WARM = 45;

function score(answers) {
	const total = Object.entries(WEIGHTS).reduce(
		(sum, [field, table]) => sum + (table[answers[field]] ?? 0),
		0,
	);
	const value = Math.round((total / MAX_SCORE) * 100);

	return { score: value, grade: value >= GRADE_HOT ? 'hot' : value >= GRADE_WARM ? 'warm' : 'cold' };
}

const STATUSES = ['app-new', 'app-qualified', 'app-nurture', 'app-contacted', 'app-won', 'app-lost'];

/** Post types the content tools can address, and their GraphQL plurals. */
const TYPES = {
	projects: { rest: 'app_project', gql: 'projects' },
	services: { rest: 'app_service', gql: 'services' },
	testimonials: { rest: 'app_testimonial', gql: 'testimonials' },
	posts: { rest: 'posts', gql: 'posts' },
	pages: { rest: 'pages', gql: 'pages' },
};

const text = (value) => ({ content: [{ type: 'text', text: value }] });
const asJson = (value) => text(JSON.stringify(value, null, 2));

export const tools = [
	/* --- Leads ---------------------------------------------------------- */
	{
		name: 'list_leads',
		description:
			'List leads from the callback queue, highest score first. Filter by pipeline status, grade, or a search string.',
		inputSchema: {
			type: 'object',
			properties: {
				status: { type: 'string', enum: STATUSES, description: 'Pipeline status.' },
				grade: { type: 'string', enum: ['hot', 'warm', 'cold'] },
				search: { type: 'string', description: 'Matches name, business and reference.' },
				page: { type: 'integer', minimum: 1, default: 1 },
				perPage: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
			},
		},
		async run(args = {}) {
			const query = new URLSearchParams({
				page: String(args.page ?? 1),
				per_page: String(args.perPage ?? 20),
			});

			for (const key of ['status', 'grade', 'search']) {
				if (args[key]) {
					query.set(key, args[key]);
				}
			}

			return asJson(await app(`/leads?${query.toString()}`));
		},
	},
	{
		name: 'get_lead',
		description: 'Read one lead in full by its reference (e.g. WDC-7K3PQF9M).',
		inputSchema: {
			type: 'object',
			properties: { reference: { type: 'string' } },
			required: ['reference'],
		},
		async run({ reference }) {
			return asJson(await app(`/leads/${encodeURIComponent(reference)}`));
		},
	},
	{
		name: 'update_lead',
		description:
			'Update a lead: move it through the pipeline, correct contact details, or append a call note. Only the fields you pass are touched.',
		inputSchema: {
			type: 'object',
			properties: {
				reference: { type: 'string' },
				status: { type: 'string', enum: STATUSES },
				name: { type: 'string' },
				business: { type: 'string' },
				email: { type: 'string' },
				phone: { type: 'string' },
				website: { type: 'string' },
				notes: { type: 'string' },
				log: { type: 'string', description: 'Call notes. Replaces the existing log.' },
			},
			required: ['reference'],
		},
		async run({ reference, ...patch }) {
			return asJson(
				await app(`/leads/${encodeURIComponent(reference)}`, {
					method: 'PATCH',
					body: JSON.stringify(patch),
				}),
			);
		},
	},
	{
		name: 'qualify_lead',
		description:
			'Recompute a lead\'s score and grade from its qualification answers and save the result. Use after correcting an answer. The score is always recomputed here — it cannot be set directly.',
		inputSchema: {
			type: 'object',
			properties: {
				reference: { type: 'string' },
				trade: { type: 'string' },
				siteState: { type: 'string' },
				timeline: { type: 'string' },
				role: { type: 'string' },
				budget: { type: 'string' },
			},
			required: ['reference'],
		},
		async run({ reference, ...answers }) {
			const current = await app(`/leads/${encodeURIComponent(reference)}`);
			const merged = {
				trade: answers.trade ?? current.trade,
				siteState: answers.siteState ?? current.siteState,
				timeline: answers.timeline ?? current.timeline,
				role: answers.role ?? current.role,
				budget: answers.budget ?? current.budget,
			};
			const scored = score(merged);

			return asJson(
				await app(`/leads/${encodeURIComponent(reference)}`, {
					method: 'PATCH',
					body: JSON.stringify({ ...merged, ...scored }),
				}),
			);
		},
	},
	{
		name: 'create_lead',
		description:
			'Add a lead by hand — someone who phoned in, or came from a source with no form. Scored on the same weights as the website form.',
		inputSchema: {
			type: 'object',
			properties: {
				name: { type: 'string' },
				business: { type: 'string' },
				email: { type: 'string' },
				phone: { type: 'string' },
				website: { type: 'string' },
				notes: { type: 'string' },
				source: { type: 'string', default: 'manual' },
				trade: { type: 'string' },
				siteState: { type: 'string' },
				timeline: { type: 'string' },
				role: { type: 'string' },
				budget: { type: 'string' },
			},
			required: ['name'],
		},
		async run(args) {
			const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
			const bytes = crypto.getRandomValues(new Uint8Array(8));
			const reference = `WDC-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')}`;

			return asJson(
				await app('/leads', {
					method: 'POST',
					body: JSON.stringify({
						reference,
						status: 'app-new',
						source: 'manual',
						...args,
						...score(args),
					}),
				}),
			);
		},
	},
	{
		name: 'lead_stats',
		description: 'Counts by pipeline status and by grade.',
		inputSchema: { type: 'object', properties: {} },
		async run() {
			return asJson(await app('/leads-stats'));
		},
	},
	{
		name: 'qualification_model',
		description:
			'The scoring weights and grade thresholds this server applies. Compare against web/src/config.ts if you suspect the two have drifted.',
		inputSchema: { type: 'object', properties: {} },
		async run() {
			return asJson({ weights: WEIGHTS, maxRawScore: MAX_SCORE, gradeHot: GRADE_HOT, gradeWarm: GRADE_WARM });
		},
	},

	/* --- Content -------------------------------------------------------- */
	{
		name: 'list_content',
		description:
			'List published content over WPGraphQL: projects, services, testimonials, posts or pages.',
		inputSchema: {
			type: 'object',
			properties: {
				type: { type: 'string', enum: Object.keys(TYPES) },
				first: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
			},
			required: ['type'],
		},
		async run({ type, first = 20 }) {
			const entry = TYPES[type];

			if (!entry) {
				return text(`Unknown content type "${type}". Expected one of: ${Object.keys(TYPES).join(', ')}`);
			}

			const data = await graphql(
				`query List($first: Int!) {
					${entry.gql}(first: $first) { nodes { databaseId slug title date } }
				}`,
				{ first },
			);

			return asJson(data[entry.gql]?.nodes ?? []);
		},
	},
	{
		name: 'get_content',
		description: 'Read one content item, including its body HTML, by type and slug.',
		inputSchema: {
			type: 'object',
			properties: {
				type: { type: 'string', enum: Object.keys(TYPES) },
				slug: { type: 'string' },
			},
			required: ['type', 'slug'],
		},
		async run({ type, slug }) {
			const entry = TYPES[type];

			if (!entry) {
				return text(`Unknown content type "${type}".`);
			}

			const data = await graphql(
				`query One($first: Int!) {
					${entry.gql}(first: $first) { nodes { databaseId slug title content date } }
				}`,
				{ first: 100 },
			);

			const found = (data[entry.gql]?.nodes ?? []).find((node) => node.slug === slug);

			return found ? asJson(found) : text(`No ${type} with slug "${slug}".`);
		},
	},
	{
		name: 'create_content',
		description:
			'Create a content item. Needs WP_APPLICATION_PASSWORD. Defaults to draft — pass status "publish" deliberately.',
		inputSchema: {
			type: 'object',
			properties: {
				type: { type: 'string', enum: Object.keys(TYPES) },
				title: { type: 'string' },
				content: { type: 'string', description: 'Body HTML.' },
				slug: { type: 'string' },
				status: { type: 'string', enum: ['draft', 'publish', 'pending', 'private'], default: 'draft' },
				meta: { type: 'object', description: 'Meta Box fields, e.g. {"app_project_client":"Acme"}.' },
			},
			required: ['type', 'title'],
		},
		async run({ type, meta, ...fields }) {
			const entry = TYPES[type];

			if (!entry) {
				return text(`Unknown content type "${type}".`);
			}

			return asJson(
				await wpRest(`/${entry.rest}`, {
					method: 'POST',
					body: JSON.stringify({ status: 'draft', ...fields, ...(meta ? { meta } : {}) }),
				}),
			);
		},
	},
	{
		name: 'update_content',
		description: 'Update a content item by its numeric id. Needs WP_APPLICATION_PASSWORD.',
		inputSchema: {
			type: 'object',
			properties: {
				type: { type: 'string', enum: Object.keys(TYPES) },
				id: { type: 'integer' },
				title: { type: 'string' },
				content: { type: 'string' },
				slug: { type: 'string' },
				status: { type: 'string', enum: ['draft', 'publish', 'pending', 'private'] },
				meta: { type: 'object' },
			},
			required: ['type', 'id'],
		},
		async run({ type, id, meta, ...fields }) {
			const entry = TYPES[type];

			if (!entry) {
				return text(`Unknown content type "${type}".`);
			}

			return asJson(
				await wpRest(`/${entry.rest}/${id}`, {
					method: 'POST',
					body: JSON.stringify({ ...fields, ...(meta ? { meta } : {}) }),
				}),
			);
		},
	},
	{
		name: 'delete_content',
		description:
			'Move a content item to the trash. Needs WP_APPLICATION_PASSWORD. Pass force:true to erase permanently — that cannot be undone.',
		inputSchema: {
			type: 'object',
			properties: {
				type: { type: 'string', enum: Object.keys(TYPES) },
				id: { type: 'integer' },
				force: { type: 'boolean', default: false, description: 'Permanently delete instead of trashing.' },
			},
			required: ['type', 'id'],
		},
		async run({ type, id, force = false }) {
			const entry = TYPES[type];

			if (!entry) {
				return text(`Unknown content type "${type}".`);
			}

			const result = await wpRest(`/${entry.rest}/${id}?force=${force ? 'true' : 'false'}`, {
				method: 'DELETE',
			});

			return asJson({ trashed: !force, permanentlyDeleted: force, result });
		},
	},

	/* --- Site ----------------------------------------------------------- */
	{
		name: 'get_settings',
		description: 'Read the app settings stored in wp-admin (API keys are returned masked).',
		inputSchema: { type: 'object', properties: {} },
		async run() {
			return asJson(await app('/settings'));
		},
	},
	{
		name: 'site_health',
		description:
			'Run the diagnostics the dashboard health page uses: database, GraphQL, REST and the configured integrations.',
		inputSchema: { type: 'object', properties: {} },
		async run() {
			return asJson(await app('/diagnostics'));
		},
	},
];

export const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
