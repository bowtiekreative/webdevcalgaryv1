/**
 * Leads — the operational side of the funnel.
 *
 * Nothing is sold on the site, so a lead is the whole product of a visit. This
 * mints the reference, records the lead in WordPress so it shows up in a queue
 * somebody can actually work, and sends the two emails that have to go out.
 *
 * Failure policy is deliberate and asymmetric. Recording and emailing are both
 * best-effort: if WordPress or Emailit is down, the visitor still gets their
 * confirmation, because from their side the form worked and telling them
 * otherwise would be a lie. Failures are logged loudly, with the whole payload,
 * because that log line is the only way to recover a lead that did not save.
 */

import { contact, site } from '../config';
import { request } from './auth/wp';
import type { Grade, Qualification } from './qualify';
import { nextAction, summarise } from './qualify';
import { envValue } from './settings';

/**
 * Pipeline. The status is where a lead *is*, not how good it is — the grade
 * says that. Keeping them separate means a cold lead that buys anyway, or a
 * hot one that ghosts, does not need the scoring model changed.
 */
export type LeadStatus =
	| 'app-new'
	| 'app-qualified'
	| 'app-nurture'
	| 'app-contacted'
	| 'app-won'
	| 'app-lost';

export interface LeadInput {
	reference: string;
	status: LeadStatus;
	name?: string;
	business?: string;
	email?: string;
	phone?: string;
	website?: string;
	notes?: string;
	source?: string;
	/** Qualification answers, as choice ids. */
	trade?: string;
	siteState?: string;
	timeline?: string;
	role?: string;
	budget?: string;
	/** Computed server-side in lib/qualify.ts. Never taken from a request. */
	score?: number;
	grade?: Grade;
}

/* -------------------------------------------------------------------------
 * References
 * ---------------------------------------------------------------------- */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * A short, human-readable, unguessable reference: WDC-7K3PQF9M.
 *
 * Unguessable matters because the thank-you page is reachable with only this
 * value. Ambiguous glyphs (0/O, 1/I) are left out so it survives being read
 * down a phone line, which is how a fair number of these get quoted back.
 */
export function newReference(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(8));

	return `WDC-${Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('')}`;
}

/* -------------------------------------------------------------------------
 * Persistence
 * ---------------------------------------------------------------------- */

/** Write the lead to WordPress. Never throws — see the failure policy above. */
export async function recordLead(lead: LeadInput): Promise<boolean> {
	try {
		await request('/leads', { method: 'POST', body: JSON.stringify(lead) });

		return true;
	} catch (error) {
		console.error('[leads] could not record lead in WordPress:', error, JSON.stringify(lead));

		return false;
	}
}

export type StoredLead = Partial<LeadInput> & { id: number; status: string; date: string };

/** Read a lead back by reference. Null rather than throwing, same reason. */
export async function fetchLead(reference: string): Promise<StoredLead | null> {
	if (!reference) {
		return null;
	}

	try {
		return await request<StoredLead>(`/leads/${encodeURIComponent(reference)}`);
	} catch (error) {
		console.error('[leads] could not read lead back:', reference, error);

		return null;
	}
}

/* -------------------------------------------------------------------------
 * Notifications
 * ---------------------------------------------------------------------- */

/** Where new leads are announced. */
function salesInbox(): string {
	return envValue('SALES_NOTIFY_EMAIL') || contact.email;
}

function escapeHtml(value: string): string {
	return value.replace(
		/[&<>"']/g,
		(char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
	);
}

async function send(options: {
	to: string;
	subject: string;
	lines: string[];
	replyTo?: string;
}): Promise<void> {
	const { emailitConfigured, sendEmail } = await import('./emailit/client');

	if (!(await emailitConfigured())) {
		console.warn('[leads] Emailit is not configured; skipped:', options.subject);

		return;
	}

	await sendEmail({
		to: options.to,
		subject: options.subject,
		replyTo: options.replyTo ?? contact.email,
		text: options.lines.join('\n'),
		html: options.lines
			.map((line) => (line === '' ? '<br>' : `<p style="margin:0 0 10px">${escapeHtml(line)}</p>`))
			.join('\n'),
	});
}

/** Wrap a notification so a mail outage never breaks a submission. */
async function bestEffort(label: string, task: () => Promise<void>): Promise<void> {
	try {
		await task();
	} catch (error) {
		console.error(`[leads] ${label} failed:`, error);
	}
}

/**
 * Acknowledge the lead, and put it in front of us with its grade.
 *
 * The internal subject leads with the grade because that is the only thing
 * that changes what happens next — a queue sorted by anything else is a queue
 * nobody works.
 */
export async function notifyLead(lead: LeadInput, scored: Qualification): Promise<void> {
	if (lead.email) {
		await bestEffort('lead acknowledgement', () =>
			send({
				to: lead.email as string,
				subject: `Got it — I'll call you today (${lead.reference})`,
				lines: [
					`Thanks ${lead.name ?? ''}`.trim() + ',',
					'',
					"I've got your details and I'll call you back today.",
					'',
					`If you'd rather not wait, call or text ${contact.phone} — that's the fastest way to reach me, and you'll get a person, not a queue.`,
					'',
					`Reference: ${lead.reference}`,
					'',
					`${site.name} · ${contact.company}`,
				],
			}),
		);
	}

	await bestEffort('lead notification', () =>
		send({
			to: salesInbox(),
			replyTo: lead.email || contact.email,
			subject: `${(lead.grade ?? 'cold').toUpperCase()} ${scored.score}/100 — ${lead.business || lead.name || lead.reference}`,
			lines: [
				nextAction(lead.grade ?? 'cold'),
				'',
				`Reference: ${lead.reference}`,
				`Score: ${scored.score}/100 (${lead.grade})`,
				'',
				`Name: ${lead.name ?? '—'}`,
				`Business: ${lead.business ?? '—'}`,
				`Phone: ${lead.phone ?? '—'}`,
				`Email: ${lead.email ?? '—'}`,
				`Website: ${lead.website || '—'}`,
				'',
				'Answers:',
				summarise(scored),
				'',
				`Their words: ${lead.notes || '—'}`,
				`From: ${lead.source ?? '—'}`,
			],
		}),
	);
}
