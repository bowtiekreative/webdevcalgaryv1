/**
 * Content-layer loader for WPGraphQL.
 *
 * Using the content layer rather than fetching inside each page means:
 *  - WordPress is queried once per collection per build, not once per page
 *  - entries are validated against a zod schema, so a renamed Meta Box field
 *    fails loudly at build time instead of rendering "undefined"
 *  - `render(entry)` works, because we store WordPress's HTML as pre-rendered
 *    content
 *  - the store persists between dev-server restarts
 */

import type { Loader, LoaderContext } from 'astro/loaders';
import { failOnError, wpQuery, type Connection } from './client';
import type { BuiltEntry } from './schema';

export interface WpLoaderOptions<TNode> {
	/** Collection label, used in log output and the loader name. */
	label: string;
	/** Query document. Must accept `$first: Int!` and `$after: String`. */
	query: string;
	/** Pick the cursor connection out of the query result. */
	select: (data: any) => Connection<TNode> | null | undefined;
	/** Map one node to a store entry, or null to skip it. */
	build: (node: TNode) => BuiltEntry | null;
	/** Nodes per request. WPGraphQL caps this at 100. */
	pageSize?: number;
}

/** Walk the connection to the end. */
async function fetchAll<TNode>(options: WpLoaderOptions<TNode>): Promise<TNode[]> {
	const pageSize = Math.min(100, options.pageSize ?? 100);
	const nodes: TNode[] = [];
	let after: string | null = null;

	// Bounded so a server that always reports hasNextPage can't hang the build.
	for (let page = 0; page < 200; page++) {
		const data = await wpQuery<Record<string, unknown>>(
			options.query,
			{ first: pageSize, after },
			{ label: options.label },
		);

		const connection = options.select(data);

		if (!connection) {
			break;
		}

		nodes.push(...(connection.nodes ?? []));

		if (!connection.pageInfo?.hasNextPage || !connection.pageInfo.endCursor) {
			break;
		}

		after = connection.pageInfo.endCursor;
	}

	return nodes;
}

export function wpLoader<TNode>(options: WpLoaderOptions<TNode>): Loader {
	return {
		name: `wp:${options.label}`,
		load: async ({ store, parseData, generateDigest, logger }: LoaderContext): Promise<void> => {
			let nodes: TNode[];

			try {
				nodes = await fetchAll(options);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);

				if (failOnError()) {
					throw error;
				}

				// Keep whatever the previous build stored rather than wiping the
				// site because WordPress happened to be down. Loud warning, no
				// hard failure — set WP_FAIL_ON_ERROR=1 in CI to invert this.
				logger.warn(`Could not load "${options.label}": ${message}`);
				logger.warn(`Building with the previously cached "${options.label}" entries (${store.keys().length}).`);
				logger.warn('Set WP_FAIL_ON_ERROR=1 to treat this as a build failure instead.');

				return;
			}

			store.clear();

			let stored = 0;
			let skipped = 0;

			for (const node of nodes) {
				const entry = options.build(node);

				if (!entry) {
					skipped++;
					continue;
				}

				// parseData applies the collection's zod schema and throws on a
				// mismatch, which is what surfaces schema drift at build time.
				const data = await parseData({ id: entry.id, data: entry.data });

				store.set({
					id: entry.id,
					data,
					digest: generateDigest(data),
					rendered: { html: entry.html },
				});

				stored++;
			}

			logger.info(`Loaded ${stored} ${options.label}${skipped > 0 ? ` (${skipped} skipped)` : ''}`);
		},
	};
}
