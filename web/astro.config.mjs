// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
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
	output: 'static',
	trailingSlash: 'never',

	// wpDevRefresh only registers an astro:server:setup hook, so it does nothing
	// during a production build.
	integrations: [sitemap(), wpDevRefresh()],

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
