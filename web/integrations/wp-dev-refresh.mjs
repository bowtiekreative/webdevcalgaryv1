/**
 * Dev-only integration that keeps the content layer in sync with WordPress.
 *
 * Why this is needed: content-layer loaders run once when the dev server starts
 * and the result is cached in node_modules/.astro/data-store.json. Nothing polls
 * the CMS, so without this you edit a post in wp-admin, reload, and see the old
 * content until you restart the dev server.
 *
 * It provides two ways to refresh, and both are no-ops in a production build:
 *
 * 1. POST /_refresh — a webhook endpoint. Point WordPress's APP_BUILD_HOOK_URL
 *    at it and saving a post updates the dev server immediately. From inside the
 *    WordPress container the host is `host.docker.internal` (docker-compose.yml
 *    maps it), so:
 *        BUILD_HOOK_URL=http://host.docker.internal:4321/_refresh
 *
 * 2. Polling — asks WordPress for a cheap fingerprint (every id + modified date,
 *    no post content) on an interval and refreshes only when it changes. Costs
 *    one small query per tick and needs no WordPress configuration, which is why
 *    it is on by default. Disable with WP_DEV_POLL_MS=0.
 *
 * Deliberately plain JS with its own fetch rather than importing src/lib/wp:
 * this file is loaded by astro.config.mjs, and keeping it dependency-free avoids
 * pulling app code into the config graph.
 */

/** Fingerprint query — ids and timestamps only, so it stays cheap to poll. */
const FINGERPRINT_QUERY = /* GraphQL */ `
	query ContentFingerprint {
		pages(first: 100) {
			nodes {
				databaseId
				modified
			}
		}
		posts(first: 100) {
			nodes {
				databaseId
				modified
			}
		}
		projects(first: 100) {
			nodes {
				databaseId
				modified
			}
		}
		services(first: 100) {
			nodes {
				databaseId
				modified
			}
		}
		testimonials(first: 100) {
			nodes {
				databaseId
				modified
			}
		}
	}
`;

/**
 * @param {string} endpoint
 * @returns {Promise<string|null>} Fingerprint, or null if WordPress is unreachable.
 */
async function fetchFingerprint(endpoint) {
	try {
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ query: FINGERPRINT_QUERY }),
			signal: AbortSignal.timeout(10_000),
		});

		if (!response.ok) {
			return null;
		}

		const payload = await response.json();

		if (payload.errors?.length || !payload.data) {
			return null;
		}

		// The serialised shape is the fingerprint: any added, removed or edited
		// entry changes it. Term renames and menu edits do not — those still
		// need a dev-server restart.
		return JSON.stringify(payload.data);
	} catch {
		return null;
	}
}

/**
 * Ask WordPress for the current site mode.
 *
 * @param {string} endpoint GraphQL endpoint, used to derive the REST origin.
 * @param {string} secret   Shared secret.
 * @returns {Promise<string|null>} Mode, or null if it could not be determined.
 */
async function fetchSiteMode(endpoint, secret) {
	if (!secret) {
		return null;
	}

	try {
		const origin = new URL(endpoint).origin;
		const response = await fetch(`${origin}/wp-json/app/v1/site-mode`, {
			headers: { Accept: 'application/json', 'X-App-Secret': secret },
			signal: AbortSignal.timeout(8_000),
		});

		if (!response.ok) {
			return null;
		}

		const payload = await response.json();

		return typeof payload.mode === 'string' ? payload.mode : null;
	} catch {
		return null;
	}
}

/**
 * @param {{endpoint?: string, secret?: string, pollMs?: number}} [options]
 *   Passed in from astro.config, which is the only place that has read .env.
 *   Astro loads .env into import.meta.env for application code, not into
 *   process.env, so an integration cannot read it directly.
 * @returns {import('astro').AstroIntegration}
 */
export default function wpDevRefresh(options = {}) {
	const endpoint = options.endpoint || 'http://localhost:8080/graphql';
	const secret = options.secret || '';
	const pollMs = Number(options.pollMs ?? 5000);

	return {
		name: 'app:wp-dev-refresh',
		hooks: {
			/*
			 * Building while the site is gated bakes the coming-soon page into
			 * every prerendered file. That is intended — it is how the public
			 * site gets gated on a static host — but it is very easy to do by
			 * accident and then wonder why the site is blank, so say it loudly.
			 */
			'astro:build:start': async ({ logger }) => {
				const mode = await fetchSiteMode(endpoint, secret);

				if (mode && mode !== 'live') {
					logger.warn('');
					logger.warn(`  Site mode is "${mode}" — every prerendered page in this build will be`);
					logger.warn('  the gate page, not the real site. Set it back to Live in');
					logger.warn('  Settings -> App Settings and rebuild before deploying.');
					logger.warn('');
				}
			},

			'astro:server:setup': ({ server, refreshContent, logger }) => {
				// Guards against a refresh triggered while one is already running.
				let refreshing = false;
				let fingerprint = null;

				/** @param {string} reason */
				const refresh = async (reason) => {
					if (refreshing) {
						return false;
					}

					refreshing = true;

					try {
						await refreshContent({ context: { reason } });
						logger.info(`Content refreshed (${reason})`);
						return true;
					} catch (error) {
						logger.warn(`Content refresh failed: ${error instanceof Error ? error.message : String(error)}`);
						return false;
					} finally {
						refreshing = false;
					}
				};

				/* --- 1. Webhook endpoint --------------------------------------- */
				server.middlewares.use('/_refresh', (req, res) => {
					if (req.method !== 'POST') {
						res.statusCode = 405;
						res.setHeader('Allow', 'POST');
						res.end('Method Not Allowed — POST to this URL to refresh content.');
						return;
					}

					// Drain the body so WordPress's non-blocking request completes
					// cleanly; its contents are not needed.
					req.resume();
					req.on('end', async () => {
						const ok = await refresh('webhook');

						// Re-baseline so the poller does not immediately repeat this.
						if (ok) {
							fingerprint = await fetchFingerprint(endpoint);
						}

						res.statusCode = ok ? 200 : 500;
						res.setHeader('Content-Type', 'application/json');
						res.end(JSON.stringify({ refreshed: ok }));
					});
				});

				/* --- 2. Polling ------------------------------------------------ */
				if (!Number.isFinite(pollMs) || pollMs <= 0) {
					logger.info('Watching WordPress: polling disabled, POST /_refresh to update content.');
					return;
				}

				logger.info(`Watching WordPress for changes every ${Math.round(pollMs / 1000)}s (WP_DEV_POLL_MS=0 to disable).`);

				const timer = setInterval(async () => {
					const next = await fetchFingerprint(endpoint);

					// null means unreachable — say nothing rather than spam the log
					// every tick while WordPress is down.
					if (next === null) {
						return;
					}

					if (fingerprint === null) {
						fingerprint = next;
						return;
					}

					if (next !== fingerprint) {
						fingerprint = next;
						await refresh('WordPress changed');
					}
				}, pollMs);

				// Never hold the process open on this timer.
				timer.unref?.();

				// Seed the baseline so the first tick does not fire a needless refresh.
				void fetchFingerprint(endpoint).then((initial) => {
					fingerprint ??= initial;
				});

				server.httpServer?.on('close', () => clearInterval(timer));
			},
		},
	};
}
