/**
 * POST /api/leads/start — the qualification form.
 *
 * The site's only conversion. Accepts a plain form post (so it works with
 * JavaScript off) and answers with JSON when the browser asks for it. Either
 * way the lead is scored, recorded in WordPress and announced by email.
 *
 * The score is computed here, never accepted from the request. The form posts
 * choice *ids*; lib/qualify.ts applies the weights. That matters because the
 * grade decides who gets called first — a request that could name its own
 * grade could jump the queue.
 *
 * No CSRF token: this is an unauthenticated public form with no session to
 * ride on, so a token would protect nothing. Abuse is handled by the honeypot
 * and a per-IP rate limit instead.
 */

import type { APIContext, APIRoute } from 'astro';
import { newReference, notifyLead, recordLead } from '../../../lib/leads';
import { qualify } from '../../../lib/qualify';
import { clientKey, rateLimited } from '../../../lib/rate-limit';

export const prerender = false;

/** Per-IP submissions allowed in the window. */
const LIMIT = 5;
const WINDOW_MS = 10 * 60_000;

function field(form: FormData, name: string, max = 500): string {
	return String(form.get(name) ?? '')
		.trim()
		.slice(0, max);
}

/** JSON for fetch, a redirect for a plain form post. */
function respond(
	context: APIContext,
	body: { ok: boolean; error?: string; redirect?: string },
	status = 200,
): Response {
	const wantsJson = context.request.headers.get('accept')?.includes('application/json');

	if (wantsJson) {
		return new Response(JSON.stringify(body), {
			status,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const location = body.ok
		? (body.redirect ?? '/thank-you?lead=1')
		: `/?error=${encodeURIComponent(body.error ?? 'Something went wrong.')}#start`;

	return new Response(null, { status: 303, headers: { Location: location } });
}

export const POST: APIRoute = async (context) => {
	let form: FormData;

	try {
		form = await context.request.formData();
	} catch {
		return respond(context, { ok: false, error: 'Could not read that submission.' }, 400);
	}

	// Honeypot. Bots fill every field they find; people never see this one.
	// Answer 200 so the bot has nothing to tune against.
	if (field(form, 'company_website') !== '') {
		return respond(context, { ok: true, redirect: '/thank-you?lead=1' });
	}

	if (
		rateLimited(clientKey(context.request, context.clientAddress), {
			name: 'leads',
			limit: LIMIT,
			windowMs: WINDOW_MS,
		})
	) {
		return respond(
			context,
			{ ok: false, error: 'Too many submissions. Call us instead — we always pick up.' },
			429,
		);
	}

	const name = field(form, 'name', 120);
	const business = field(form, 'business', 160);
	const phone = field(form, 'phone', 40);
	const email = field(form, 'email', 200);

	if (name === '' || phone === '' || email === '') {
		return respond(context, { ok: false, error: 'Name, phone and email are all needed.' }, 400);
	}

	if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
		return respond(context, { ok: false, error: 'That email address does not look right.' }, 400);
	}

	const answers = {
		trade: field(form, 'trade', 40),
		siteState: field(form, 'siteState', 40),
		timeline: field(form, 'timeline', 40),
		role: field(form, 'role', 40),
		budget: field(form, 'budget', 40),
	};

	const scored = qualify(answers);
	const reference = newReference();

	const lead = {
		reference,
		// Everything lands as new. Grading sorts the queue; a human decides
		// whether it is actually qualified, which is what the status means.
		status: 'app-new' as const,
		name,
		business,
		phone,
		email,
		website: field(form, 'website', 300),
		notes: field(form, 'notes', 2_000),
		source: field(form, 'source', 200) || '/',
		...answers,
		score: scored.score,
		grade: scored.grade,
	};

	// Both are best-effort by design — a lead that reached us by email is not
	// lost just because WordPress was restarting.
	await recordLead(lead);
	await notifyLead(lead, scored);

	return respond(context, { ok: true, redirect: `/thank-you?lead=1&ref=${reference}` });
};
