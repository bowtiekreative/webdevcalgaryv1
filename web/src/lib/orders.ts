/**
 * Orders and leads — the operational side of the funnel.
 *
 * Money lives in PayPal. This module is what turns a payment into work: it
 * mints the reference, computes the go-live deadline the guarantee is written
 * against, records the job in WordPress so it shows up in a queue somebody can
 * actually look at, and sends the two emails that have to go out.
 *
 * Failure policy is deliberate and asymmetric:
 *
 *   - Recording and emailing are best-effort. If WordPress or Emailit is down,
 *     the customer still sees their confirmation — PayPal already took the
 *     money, and showing them an error would be a lie about the state of the
 *     world. Failures are logged loudly for the operator instead.
 *   - Pricing and capture are not best-effort. Those throw.
 */

import { contact, RUSH_CUTOFF_HOUR_MT, RUSH_WINDOW_HOURS, site, TIMEZONE } from '../config';
import { request } from './auth/wp';
import { envValue } from './settings';

export type OrderStatus = 'app-lead' | 'app-pending' | 'app-paid' | 'app-building' | 'app-refunded';

export interface OrderInput {
	reference: string;
	status: OrderStatus;
	provider?: string;
	providerId?: string;
	captureId?: string;
	amount?: number;
	currency?: string;
	/** Comma-joined offer ids, e.g. "rush,gbp". */
	offers?: string;
	plan?: string;
	speed?: string;
	name?: string;
	business?: string;
	email?: string;
	phone?: string;
	website?: string;
	notes?: string;
	source?: string;
	goLiveAt?: string;
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
 * The guarantee's clock
 * ---------------------------------------------------------------------- */

/** Hour-of-day and weekday for a moment, read in Mountain Time. */
function mountainParts(at: Date): { hour: number; weekday: number } {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: TIMEZONE,
		hour: 'numeric',
		hour12: false,
		weekday: 'short',
	}).formatToParts(at);

	const hour = Number.parseInt(parts.find((part) => part.type === 'hour')?.value ?? '0', 10);
	const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	const weekday = names.indexOf(parts.find((part) => part.type === 'weekday')?.value ?? 'Mon');

	return { hour, weekday: weekday === -1 ? 1 : weekday };
}

/**
 * When the site has to be live, per the guarantee on the landing page:
 *
 *   "Start before 2pm and your site is live by this time tomorrow. Orders
 *   placed after 2pm MT start the next business day at 9am, live by 9am the
 *   day after. Weekend orders start Monday."
 *
 * Returned as an ISO string so it survives JSON and a WordPress meta field
 * without timezone guesswork.
 */
export function goLiveDeadline(paidAt: Date = new Date()): Date {
	const { hour, weekday } = mountainParts(paidAt);

	// Inside the window on a weekday: exactly 24 hours from now.
	const isWeekday = weekday >= 1 && weekday <= 5;

	if (isWeekday && hour < RUSH_CUTOFF_HOUR_MT) {
		return new Date(paidAt.getTime() + RUSH_WINDOW_HOURS * 3_600_000);
	}

	// Otherwise the build starts 9am on the next business day, live 9am the
	// day after that.
	const start = new Date(paidAt);
	let added = 0;

	do {
		start.setUTCDate(start.getUTCDate() + 1);
		added += 1;
	} while (!isBusinessDay(start) && added < 7);

	// Live by 9am the day after the build starts.
	do {
		start.setUTCDate(start.getUTCDate() + 1);
	} while (!isBusinessDay(start));

	return atNineMountain(start);
}

function isBusinessDay(date: Date): boolean {
	const { weekday } = mountainParts(date);

	return weekday >= 1 && weekday <= 5;
}

/**
 * 9:00 Mountain on the given day.
 *
 * Mountain is UTC-7 in summer and UTC-6 in winter, so the offset is measured
 * rather than assumed — hardcoding either one is wrong for half the year.
 */
function atNineMountain(day: Date): Date {
	const offsetMinutes = mountainOffsetMinutes(day);
	const iso = new Intl.DateTimeFormat('en-CA', {
		timeZone: TIMEZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(day);

	return new Date(`${iso}T09:00:00.000${formatOffset(offsetMinutes)}`);
}

function mountainOffsetMinutes(at: Date): number {
	const label = new Intl.DateTimeFormat('en-US', {
		timeZone: TIMEZONE,
		timeZoneName: 'longOffset',
	})
		.formatToParts(at)
		.find((part) => part.type === 'timeZoneName')?.value;

	const match = /GMT([+-])(\d{2}):(\d{2})/.exec(label ?? '');

	if (!match) {
		return -420; // MDT, the common case.
	}

	const minutes = Number(match[2]) * 60 + Number(match[3]);

	return match[1] === '-' ? -minutes : minutes;
}

function formatOffset(minutes: number): string {
	const sign = minutes < 0 ? '-' : '+';
	const abs = Math.abs(minutes);

	return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** The deadline as the customer reads it: "Tue 2:00 p.m. MT". */
export function formatDeadline(at: Date): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: TIMEZONE,
		weekday: 'short',
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
	}).format(at);
}

/* -------------------------------------------------------------------------
 * Persistence
 * ---------------------------------------------------------------------- */

/**
 * Write the order to WordPress. Never throws — see the failure policy above.
 *
 * @returns true when it landed, so callers can log a degraded path.
 */
export async function recordOrder(order: OrderInput): Promise<boolean> {
	try {
		await request('/orders', { method: 'POST', body: JSON.stringify(order) });

		return true;
	} catch (error) {
		// Loud, with the whole payload: this is the operator's only chance to
		// recover a job whose record did not save.
		console.error('[orders] could not record order in WordPress:', error, JSON.stringify(order));

		return false;
	}
}

/** Everything WordPress knows about an order. */
export type StoredOrder = Partial<OrderInput> & { id: number; status: string; date: string };

/**
 * Read an order back by reference. Returns null rather than throwing, for the
 * same reason recordOrder swallows: a lookup failure must not break a capture.
 */
export async function fetchOrder(reference: string): Promise<StoredOrder | null> {
	if (!reference) {
		return null;
	}

	try {
		return await request<StoredOrder>(`/orders/${encodeURIComponent(reference)}`);
	} catch (error) {
		console.error('[orders] could not read order back:', reference, error);

		return null;
	}
}

/* -------------------------------------------------------------------------
 * Notifications
 * ---------------------------------------------------------------------- */

/** Where new orders and leads are announced. */
function salesInbox(): string {
	return envValue('SALES_NOTIFY_EMAIL') || contact.email;
}

function escapeHtml(value: string): string {
	return value.replace(
		/[&<>"']/g,
		(char) =>
			({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
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
		console.warn('[orders] Emailit is not configured; skipped:', options.subject);

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

/** Wrap a notification so a mail outage never breaks a checkout. */
async function bestEffort(label: string, task: () => Promise<void>): Promise<void> {
	try {
		await task();
	} catch (error) {
		console.error(`[orders] ${label} failed:`, error);
	}
}

/** Tell the buyer their go-live time, and tell us there is a job to do. */
export async function notifyPaid(order: OrderInput & { deadline: Date }): Promise<void> {
	const deadline = formatDeadline(order.deadline);
	const total = `$${(order.amount ?? 0).toFixed(2)} ${order.currency ?? 'CAD'}`;

	if (order.email) {
		await bestEffort('customer receipt', () =>
			send({
				to: order.email as string,
				subject: `${order.reference} — the clock is running. Live by ${deadline}.`,
				lines: [
					`Payment received — ${total}.`,
					'',
					`Your site goes live by ${deadline}.`,
					`Order reference: ${order.reference}`,
					'',
					'What happens next:',
					'1. Reply to this email with your business details, photos if you have them, and what matters most to you.',
					'2. We build it today.',
					'3. It launches on your domain by the time above.',
					'',
					`If we miss that window the rush fee is refunded and you keep the site.`,
					'',
					`Questions before then? Call or text ${contact.phone} — you'll get a person, not a queue.`,
					'',
					`${site.name} · ${contact.company}`,
				],
			}),
		);
	}

	await bestEffort('sales notification', () =>
		send({
			to: salesInbox(),
			replyTo: order.email || contact.email,
			subject: `PAID ${total} — ${order.business || order.name || order.reference} — live by ${deadline}`,
			lines: [
				`Reference: ${order.reference}`,
				`Bought: ${order.offers ?? '—'}${order.plan ? ` · plan: ${order.plan}` : ''}`,
				`Total: ${total}`,
				`Live by: ${deadline}`,
				'',
				`Name: ${order.name ?? '—'}`,
				`Business: ${order.business ?? '—'}`,
				`Email: ${order.email ?? '—'}`,
				`Phone: ${order.phone ?? '—'}`,
				`Website: ${order.website ?? '—'}`,
				'',
				`Notes: ${order.notes ?? '—'}`,
				`PayPal order: ${order.providerId ?? '—'}`,
				`PayPal capture: ${order.captureId ?? '—'}`,
			],
		}),
	);
}

/** A form fill with no payment: acknowledge it, and put it in front of us. */
export async function notifyLead(order: OrderInput): Promise<void> {
	if (order.email) {
		await bestEffort('lead acknowledgement', () =>
			send({
				to: order.email as string,
				subject: `Got it — I'll call you today (${order.reference})`,
				lines: [
					`Thanks ${order.name ?? ''}`.trim() + ',',
					'',
					"I've got your details and I'll call you back today.",
					'',
					`If you'd rather not wait, call or text ${contact.phone} — that's the fastest way to reach me.`,
					'',
					`Reference: ${order.reference}`,
					'',
					`${site.name} · ${contact.company}`,
				],
			}),
		);
	}

	await bestEffort('lead notification', () =>
		send({
			to: salesInbox(),
			replyTo: order.email || contact.email,
			subject: `LEAD — ${order.business || order.name || order.reference} — call back today`,
			lines: [
				`Reference: ${order.reference}`,
				`Name: ${order.name ?? '—'}`,
				`Business: ${order.business ?? '—'}`,
				`Phone: ${order.phone ?? '—'}`,
				`Email: ${order.email ?? '—'}`,
				`Leaning toward: ${order.plan ?? '—'} · ${order.speed ?? '—'}`,
				'',
				`Notes: ${order.notes ?? '—'}`,
				`From: ${order.source ?? '—'}`,
			],
		}),
	);
}
