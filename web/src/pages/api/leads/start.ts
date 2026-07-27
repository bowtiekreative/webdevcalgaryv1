/**
 * POST /api/leads/start — the "call me back today" form.
 *
 * Accepts a plain form post (so it works with JavaScript off) and answers with
 * JSON when the browser asks for it. Either way the lead is recorded in
 * WordPress and announced by email.
 *
 * No CSRF token here on purpose: this is an unauthenticated public form with
 * no session to ride on, so a token would protect nothing. Abuse is handled by
 * the honeypot and a per-IP rate limit instead.
 */

import type { APIContext, APIRoute } from 'astro';
import { newReference, notifyLead, recordOrder } from '../../../lib/orders';

export const prerender = false;

/** Per-IP submissions allowed in the window. */
const LIMIT = 5;
const WINDOW_MS = 10 * 60_000;

const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
	const now = Date.now();
	const recent = (hits.get(ip) ?? []).filter((at) => now - at < WINDOW_MS);

	recent.push(now);
	hits.set(ip, recent);

	// The map is per-process and small, but a long-lived server would still
	// grow it forever without this.
	if (hits.size > 5_000) {
		for (const [key, times] of hits) {
			if (times.every((at) => now - at >= WINDOW_MS)) {
				hits.delete(key);
			}
		}
	}

	return recent.length > LIMIT;
}

function clientIp(context: APIContext): string {
	const forwarded = context.request.headers.get('x-forwarded-for');

	return forwarded?.split(',')[0]?.trim() || context.clientAddress || 'unknown';
}

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

	if (rateLimited(clientIp(context))) {
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

	const reference = newReference();

	const lead = {
		reference,
		status: 'app-lead' as const,
		name,
		business,
		phone,
		email,
		plan: field(form, 'plan', 40),
		speed: field(form, 'speed', 40),
		notes: field(form, 'notes', 2_000),
		source: field(form, 'source', 200) || '/',
	};

	// Both are best-effort by design — a lead that reached us by email is not
	// lost just because WordPress was restarting.
	await recordOrder(lead);
	await notifyLead(lead);

	return respond(context, { ok: true, redirect: `/thank-you?lead=1&ref=${reference}` });
};
