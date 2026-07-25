/**
 * Emailit client — transactional sends, audiences and campaigns.
 *
 * https://emailit.com/docs/api-reference/
 *
 * The rate limits are the important part of this file. Emailit starts new
 * workspaces at **2 messages/second and 5,000/day**, so a campaign to a few
 * thousand subscribers cannot be fired off in a loop: it would take 429s most
 * of the way through and deliver to an arbitrary prefix of the list. Every
 * bulk send here goes through a throttled queue, and `sendCampaign` reports how
 * many were actually delivered.
 */

function env(key: string): string {
	const value =
		(import.meta.env as Record<string, string | undefined>)[key] ??
		(typeof process !== 'undefined' ? process.env?.[key] : undefined);

	return value ?? '';
}

const API_BASE = 'https://api.emailit.com/v2';

export function emailitConfigured(): boolean {
	return env('EMAILIT_API_KEY').length > 0;
}

export class EmailitError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'EmailitError';
		this.status = status;
	}
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
	const key = env('EMAILIT_API_KEY');

	if (!key) {
		throw new EmailitError('EMAILIT_API_KEY is not set in web/.env.', 500);
	}

	const response = await fetch(`${API_BASE}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${key}`,
			'Content-Type': 'application/json',
			Accept: 'application/json',
			...(init.headers ?? {}),
		},
		signal: AbortSignal.timeout(20_000),
	});

	const text = await response.text();

	if (!response.ok) {
		throw new EmailitError(
			`Emailit ${path} failed (${response.status}): ${text.slice(0, 300)}`,
			response.status,
		);
	}

	return (text ? JSON.parse(text) : null) as T;
}

/* -------------------------------------------------------------------------
 * Transactional
 * ---------------------------------------------------------------------- */

export interface SendOptions {
	to: string;
	subject: string;
	html?: string;
	text?: string;
	from?: string;
	replyTo?: string;
}

export async function sendEmail(options: SendOptions): Promise<void> {
	await api('/emails/send', {
		method: 'POST',
		body: JSON.stringify({
			from: options.from || env('EMAILIT_FROM') || 'no-reply@example.com',
			to: options.to,
			subject: options.subject,
			...(options.html ? { html: options.html } : {}),
			...(options.text ? { text: options.text } : {}),
			...(options.replyTo ? { reply_to: options.replyTo } : {}),
		}),
	});
}

/* -------------------------------------------------------------------------
 * Audiences and subscribers
 * ---------------------------------------------------------------------- */

export interface Audience {
	id: string;
	name: string;
	subscriber_count?: number;
}

export interface Subscriber {
	id?: string;
	email: string;
	name?: string;
	status?: string;
	created_at?: string;
}

/**
 * Emailit's list endpoints wrap results in `data`, but not every deployment
 * does — accept both rather than crashing on a shape difference.
 */
function unwrap<T>(payload: unknown): T[] {
	if (Array.isArray(payload)) {
		return payload as T[];
	}

	const data = (payload as { data?: unknown })?.data;

	return Array.isArray(data) ? (data as T[]) : [];
}

export async function listAudiences(): Promise<Audience[]> {
	return unwrap<Audience>(await api<unknown>('/audiences/list'));
}

export async function createAudience(name: string): Promise<Audience> {
	return api<Audience>('/audiences', {
		method: 'POST',
		body: JSON.stringify({ name }),
	});
}

export async function listSubscribers(audienceId: string): Promise<Subscriber[]> {
	return unwrap<Subscriber>(
		await api<unknown>(`/audiences/${encodeURIComponent(audienceId)}/subscribers/list`),
	);
}

export async function addSubscriber(
	audienceId: string,
	subscriber: { email: string; name?: string },
): Promise<void> {
	await api(`/audiences/${encodeURIComponent(audienceId)}/subscribers/add`, {
		method: 'POST',
		body: JSON.stringify(subscriber),
	});
}

/* -------------------------------------------------------------------------
 * Campaigns
 * ---------------------------------------------------------------------- */

/**
 * Messages per second. Emailit's documented floor for a new workspace is 2/s;
 * raise EMAILIT_RATE_LIMIT once your workspace limit is lifted.
 */
function ratePerSecond(): number {
	const configured = Number(env('EMAILIT_RATE_LIMIT') || 2);

	return Number.isFinite(configured) && configured > 0 ? configured : 2;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CampaignResult {
	attempted: number;
	sent: number;
	failed: Array<{ email: string; reason: string }>;
	/** True when the send stopped early because the daily cap was hit. */
	rateLimited: boolean;
}

/**
 * Send one message per subscriber, throttled to the workspace's rate limit.
 *
 * Sequential on purpose: at 2/s there is nothing to gain from concurrency, and
 * a serial loop makes the 429 handling obvious. A 429 aborts the run rather
 * than hammering on — the daily cap does not reset for hours, so continuing
 * would just produce thousands of failures.
 */
export async function sendCampaign(options: {
	subject: string;
	html: string;
	recipients: Array<{ email: string; name?: string }>;
	from?: string;
	replyTo?: string;
	/** Called after each attempt, for progress reporting. */
	onProgress?: (sent: number, total: number) => void;
}): Promise<CampaignResult> {
	const delayMs = Math.ceil(1000 / ratePerSecond());
	const result: CampaignResult = {
		attempted: 0,
		sent: 0,
		failed: [],
		rateLimited: false,
	};

	for (const recipient of options.recipients) {
		result.attempted++;

		try {
			await sendEmail({
				to: recipient.email,
				subject: options.subject,
				html: personalize(options.html, recipient),
				from: options.from,
				replyTo: options.replyTo,
			});

			result.sent++;
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);

			result.failed.push({ email: recipient.email, reason });

			if (error instanceof EmailitError && error.status === 429) {
				result.rateLimited = true;
				break;
			}
		}

		options.onProgress?.(result.sent, options.recipients.length);

		// No point sleeping after the final message.
		if (result.attempted < options.recipients.length) {
			await sleep(delayMs);
		}
	}

	return result;
}

/** Replace {{name}} / {{email}} placeholders. */
function personalize(html: string, recipient: { email: string; name?: string }): string {
	return html
		.replaceAll('{{name}}', escapeHtml(recipient.name || recipient.email.split('@')[0] || 'there'))
		.replaceAll('{{email}}', escapeHtml(recipient.email));
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}
