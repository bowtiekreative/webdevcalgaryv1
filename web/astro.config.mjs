// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import node from '@astrojs/node';
import { loadEnv } from 'vite';
import wpDevRefresh from './integrations/wp-dev-refresh.mjs';

// astro.config runs before Astro wires up import.meta.env, so read .env
// explicitly. The empty prefix loads every key, not just PUBLIC_*.
const env = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), '');

const wpEndpoint = env.WP_GRAPHQL_ENDPOINT || 'http://localhost:8080/graphql';
const siteUrl = env.SITE_URL || 'http://localhost:4321';

/** Hostname serving wp-content/uploads, so Astro is allowed to optimise it. */
const wpHostname = (() => {
	try {
		return new URL(wpEndpoint).hostname;
	} catch {
		return 'localhost';
	}
})();

// https://astro.build/config
export default defineConfig({
	site: siteUrl,

	/*
	 * 'static' with an adapter is the hybrid mode: every route is prerendered
	 * unless it opts out with `export const prerender = false`. The marketing
	 * site stays fully static; only /login, /dashboard/** and /api/** render on
	 * demand, because sessions, webhooks and payments cannot be baked at build
	 * time.
	 */
	output: 'static',
	adapter: node({ mode: 'standalone' }),
	trailingSlash: 'never',

	// The Node adapter supplies a default session driver, so this only needs to
	// exist for Astro.session to be available.
	session: {},

	// wpDevRefresh only registers an astro:server:setup hook, so it does nothing
	// during a production build.
	integrations: [
		sitemap(),
		wpDevRefresh({
			endpoint: wpEndpoint,
			secret: env.WP_SHARED_SECRET,
			// loadEnv always yields strings; the integration wants a number.
			pollMs: env.WP_DEV_POLL_MS ? Number(env.WP_DEV_POLL_MS) : undefined,
		}),
	],

	image: {
		// WordPress media stays on the WordPress host; this lets <Image /> and
		// getImage() pull and optimise those files at build time.
		domains: [wpHostname],
		responsiveStyles: true,
	},

	prefetch: {
		prefetchAll: true,
		defaultStrategy: 'viewport',
	},

	vite: {
		server: {
			// Vite blocks unknown Host headers (DNS-rebinding protection). The
			// WordPress container reaches the dev server as host.docker.internal
			// when posting to /_refresh, so that name has to be allowed.
			// Dev-server only — has no effect on a build.
			allowedHosts: ['host.docker.internal'],
		},
	},
});
