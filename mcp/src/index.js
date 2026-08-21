#!/usr/bin/env node
/**
 * WebDevCalgary MCP server.
 *
 * Full read/write access to the site: the lead queue, the published content
 * and the app settings. Speaks stdio, so it is launched by the MCP client
 * rather than run as a service.
 *
 * Configuration is environment only — the same variables the Astro app uses,
 * so a working front end means a working server:
 *
 *   WP_GRAPHQL_ENDPOINT      required. Also gives the REST origin.
 *   WP_SHARED_SECRET         required. Leads and settings.
 *   WP_APPLICATION_PASSWORD  optional. Only content writes need it.
 *
 * Errors come back as tool results rather than protocol errors. A model that
 * gets "WP_SHARED_SECRET is not set" as an answer can tell the user what to
 * fix; a transport-level failure just looks like the server is broken.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { config } from './wp.js';
import { tools, toolsByName } from './tools.js';

const server = new Server(
	{ name: 'webdevcalgary', version: '1.0.0' },
	{ capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const tool = toolsByName.get(request.params.name);

	if (!tool) {
		return {
			isError: true,
			content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
		};
	}

	try {
		return await tool.run(request.params.arguments ?? {});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		return { isError: true, content: [{ type: 'text', text: message }] };
	}
});

// Fail fast on obviously broken configuration, but only on the parts that are
// always required — a missing application password is a per-tool problem, not
// a reason to refuse to start.
try {
	const { endpoint, secret } = config();

	if (!secret) {
		console.error('[webdevcalgary-mcp] warning: WP_SHARED_SECRET is not set; lead tools will fail.');
	}

	console.error(`[webdevcalgary-mcp] ready, talking to ${endpoint}`);
} catch (error) {
	console.error(`[webdevcalgary-mcp] ${error instanceof Error ? error.message : error}`);
	process.exit(1);
}

await server.connect(new StdioServerTransport());
