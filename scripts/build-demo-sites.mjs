#!/usr/bin/env node
/**
 * Convert the design deck's portfolio pages into servable demo sites.
 *
 *   node scripts/build-demo-sites.mjs
 *
 * Source: "Design system and funnel review/Portfolio - *.dc.html" — fourteen
 * complete, deliberately *different* websites, one per Calgary industry. They
 * are not variations on a template: HVAC is Barlow Condensed on navy, the med
 * spa is Cormorant Garamond on clay, the law firm is Playfair on ink. Sections
 * differ too (Hail claims, Snow, Menu, Practice areas). Rebuilding them as one
 * parameterised Astro component would erase the only thing they are for —
 * showing an owner what *their* industry's site looks like.
 *
 * So they are converted, not reimplemented. Output is plain static HTML in
 * web/public/demo/<slug>/, which Astro copies verbatim. No compiler in the
 * path means no chance of the markup drifting from the deck.
 *
 * What this rewrites, and nothing else:
 *
 *   - `<x-dc>` / `<helmet>` wrappers, which are the design tool's, not HTML's
 *   - `style-hover` / `style-focus` attributes -> real generated CSS rules
 *   - links to the other deck files -> routes on this site
 *   - adds <title>, a description, and noindex
 *   - adds a banner saying this is a demonstration
 *
 * On noindex: these are fictional businesses. Letting Google index "Chinook
 * Heating & Air" as a real Calgary HVAC company would be misleading, and would
 * compete with actual clients' sites. The banner says the same thing to anyone
 * who lands on one.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(root, 'Design system and funnel review');
const OUT_DIR = join(root, 'web', 'public', 'demo');

/** Slug + the copy the index page and <head> need, per industry. */
const SITES = {
	'HVAC': { slug: 'hvac', trade: 'HVAC', brand: 'Chinook Heating & Air', since: 2019 },
	'Plumbing': { slug: 'plumbing', trade: 'Plumbing', brand: 'Bow River Plumbing Co.', since: 2020 },
	'Electrical': { slug: 'electrical', trade: 'Electrical', brand: 'Amped Electric', since: 2021 },
	'Roofing': { slug: 'roofing', trade: 'Roofing', brand: 'Foothills Roofing', since: 2018 },
	'Landscaping': { slug: 'landscaping', trade: 'Landscaping & snow', brand: 'Prairie Edge Landscaping', since: 2022 },
	'Concrete': { slug: 'concrete', trade: 'Concrete', brand: 'Caliber Concrete Works', since: 2020 },
	'Renovation': { slug: 'renovation', trade: 'Renovation', brand: 'Northmount Renovations', since: 2019 },
	'Garage Doors': { slug: 'garage-doors', trade: 'Garage doors', brand: 'Ridgeline Garage Doors', since: 2021 },
	'Dental': { slug: 'dental', trade: 'Dental', brand: 'Kensington Dental Studio', since: 2021 },
	'Med Spa': { slug: 'med-spa', trade: 'Med spa', brand: 'Silverbirch Med Spa', since: 2022 },
	'Law': { slug: 'law', trade: 'Law', brand: 'Whitfield Law', since: 2018 },
	'Accounting': { slug: 'accounting', trade: 'Accounting', brand: 'Crossfield & Co. CPA', since: 2020 },
	'Auto Repair': { slug: 'auto-repair', trade: 'Auto repair', brand: 'Deerfoot Auto Works', since: 2019 },
	'Restaurant': { slug: 'restaurant', trade: 'Restaurant', brand: 'Spruce & Ember', since: 2023 },
};

/** Pull the contents of a tag, non-greedy, across newlines. */
function section(html, tag) {
	const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(html);

	return match ? match[1] : '';
}

/**
 * Turn `style-hover="a:b"` / `style-focus="a:b"` into generated CSS.
 *
 * The design tool applies these as pseudo-class overrides. They carry the
 * whole interaction design — the button colour flips, the card lifts — so
 * dropping them would quietly flatten every page.
 */
function extractPseudoStyles(html) {
	const rules = [];
	let index = 0;

	const converted = html.replace(
		/\s(style-hover|style-focus)="([^"]*)"/g,
		(_match, kind, declarations) => {
			const className = `dc${index++}`;
			const pseudo = kind === 'style-hover' ? ':hover' : ':focus-visible';

			rules.push(`.${className}${pseudo}{${declarations}}`);

			// Several elements carry both attributes; collect the class once and
			// merge on the second pass below.
			return ` data-dc-class="${className}"`;
		},
	);

	return { html: converted, rules };
}

/** Fold the collected marker attributes into a single class attribute. */
function applyClasses(html) {
	return html.replace(/(<[a-zA-Z][^>]*?)((?:\s+data-dc-class="[^"]*")+)([^>]*>)/g, (_m, head, markers, tail) => {
		const names = [...markers.matchAll(/data-dc-class="([^"]*)"/g)].map((m) => m[1]);

		return `${head} class="${names.join(' ')}"${tail}`;
	});
}

function escapeAttr(value) {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeText(value) {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const BANNER = (meta) => `
<div class="wdc-demo-bar">
  <span><strong>Demonstration site</strong> — ${escapeText(meta.brand)} is not a real business. This shows what a Calgary ${escapeText(meta.trade.toLowerCase())} site looks like.</span>
  <a href="/">Get one like it →</a>
</div>
<style>
.wdc-demo-bar{position:relative;z-index:9999;display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;justify-content:space-between;
  background:#14161A;color:#fff;padding:10px 22px;font:400 13px/1.5 'JetBrains Mono',ui-monospace,monospace}
.wdc-demo-bar strong{color:#F2B233;font-weight:700}
.wdc-demo-bar a{color:#fff;font-weight:700;border-bottom:2px solid #F2B233;text-decoration:none;padding-bottom:1px;white-space:nowrap}
.wdc-demo-bar a:hover{color:#F2B233}
@media print{.wdc-demo-bar{display:none}}
</style>`;

async function build() {
	const entries = (await readdir(SOURCE_DIR)).filter(
		(name) => name.startsWith('Portfolio - ') && name.endsWith('.dc.html'),
	);

	if (entries.length === 0) {
		throw new Error(`No portfolio sources found in ${SOURCE_DIR}`);
	}

	const built = [];

	for (const entry of entries) {
		const key = entry.slice('Portfolio - '.length, -'.dc.html'.length);
		const meta = SITES[key];

		if (!meta) {
			console.warn(`  skip   ${key} — no slug mapping in SITES`);
			continue;
		}

		const source = await readFile(join(SOURCE_DIR, entry), 'utf8');

		const helmet = section(source, 'helmet');
		let body = section(source, 'x-dc').replace(/<helmet[\s\S]*?<\/helmet>/i, '');

		const { html: withMarkers, rules } = extractPseudoStyles(body);
		body = applyClasses(withMarkers);

		// The deck cross-links its own files; point them at this site instead.
		body = body
			.replace(/href="Funnel - Landing\.dc\.html"/g, 'href="/"')
			.replace(/href="Home\.dc\.html"/g, 'href="/work"');

		const description = `${meta.brand} — a demonstration website for a Calgary ${meta.trade.toLowerCase()} business, built by WebDevCalgary.`;

		const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(meta.brand)} — demonstration site | WebDevCalgary</title>
<meta name="description" content="${escapeAttr(description)}">
<!-- Fictional business. Indexing it would misrepresent a real Calgary company. -->
<meta name="robots" content="noindex, nofollow">
<link rel="canonical" href="https://webdevcalgary.com/demo/${meta.slug}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${helmet.trim()}
<style>${rules.join('\n')}</style>
</head>
<body>
${BANNER(meta)}
${body.trim()}
</body>
</html>
`;

		const dir = join(OUT_DIR, meta.slug);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, 'index.html'), page, 'utf8');

		built.push({ ...meta, rules: rules.length, bytes: page.length });
		console.log(`  built  /demo/${meta.slug.padEnd(13)} ${meta.brand.padEnd(26)} ${rules.length} hover/focus rules`);
	}

	// A manifest so the Astro index page lists exactly what was generated,
	// rather than a second hand-maintained copy of the same list.
	built.sort((a, b) => a.trade.localeCompare(b.trade));
	await writeFile(
		join(root, 'web', 'src', 'demo-sites.json'),
		`${JSON.stringify(built.map(({ slug, trade, brand, since }) => ({ slug, trade, brand, since })), null, '\t')}\n`,
		'utf8',
	);

	console.log(`\n${built.length} demo sites -> web/public/demo/`);
}

build().catch((error) => {
	console.error(error);
	process.exit(1);
});
