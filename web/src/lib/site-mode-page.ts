/**
 * The coming-soon / maintenance response.
 *
 * Rendered as a self-contained string rather than an Astro page, because
 * middleware runs before routing: returning a Response here intercepts every
 * URL, including prerendered ones, without needing a route to exist. It also
 * means the page still works when the rest of the site cannot be built.
 *
 * Status codes are deliberate:
 *   coming_soon -> 200, so the launch page can be indexed and shared
 *   maintenance -> 503 + Retry-After, so search engines keep the existing
 *                  listing rather than treating the site as gone
 */

import type { SiteModeState } from './settings';
import { site } from '../config';

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

const DEFAULTS = {
	coming_soon: {
		heading: 'Something good is on the way.',
		message: 'This site is not quite ready. Check back shortly.',
	},
	maintenance: {
		heading: 'Down for maintenance.',
		message: 'We are making some improvements and will be back shortly.',
	},
} as const;

export function renderSiteModePage(state: SiteModeState): Response {
	const kind = state.mode === 'maintenance' ? 'maintenance' : 'coming_soon';
	const defaults = DEFAULTS[kind];

	const heading = escapeHtml(state.heading || defaults.heading);
	const message = escapeHtml(state.message || defaults.message);
	const until = state.until ? escapeHtml(state.until) : '';
	const name = escapeHtml(site.name);
	const mark = escapeHtml(site.mark);

	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading} — ${name}</title>
<meta name="robots" content="${kind === 'maintenance' ? 'noindex' : 'index'}, follow">
<style>
  :root{color-scheme:light dark;--ink:#14161a;--soft:#4a5058;--paper:#fff;--line:#e3e1dc;--accent:#9b2c3a}
  @media (prefers-color-scheme:dark){:root{--ink:#ecebe8;--soft:#b3b7bd;--paper:#12141a;--line:#2b303a;--accent:#e8909c}}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:2rem 1.25rem;
    background:var(--paper);color:var(--ink);
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    line-height:1.6;-webkit-font-smoothing:antialiased}
  main{max-width:34rem;text-align:center}
  .mark{color:var(--accent);font-size:2rem;line-height:1}
  .name{font-size:.8rem;letter-spacing:.14em;text-transform:uppercase;color:var(--soft);margin:.75rem 0 2rem}
  h1{font-family:ui-serif,Georgia,serif;font-weight:600;line-height:1.15;letter-spacing:-.02em;
    font-size:clamp(1.9rem,6vw,2.9rem);margin:0 0 1rem;text-wrap:balance}
  p{color:var(--soft);margin:0 auto;max-width:32rem;text-wrap:pretty}
  .until{margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--line);font-size:.9rem}
  .until strong{color:var(--ink)}
</style>
</head>
<body>
<main>
  <div class="mark" aria-hidden="true">${mark}</div>
  <p class="name">${name}</p>
  <h1>${heading}</h1>
  <p>${message}</p>
  ${until ? `<p class="until">Expected back: <strong>${until}</strong></p>` : ''}
</main>
</body>
</html>`;

	const headers: Record<string, string> = {
		'Content-Type': 'text/html; charset=utf-8',
		// Never let a CDN or browser cache the gate itself, or turning it off
		// would not be visible until caches expired.
		'Cache-Control': 'no-store, must-revalidate',
	};

	if (kind === 'maintenance') {
		// Hint at when to come back. Seconds, per RFC 9110; an hour is a safe
		// default when no date was given.
		headers['Retry-After'] = '3600';
	}

	return new Response(html, {
		status: kind === 'maintenance' ? 503 : 200,
		headers,
	});
}
