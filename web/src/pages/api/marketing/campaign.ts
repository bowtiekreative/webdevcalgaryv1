/**
 * POST /api/marketing/campaign — send a campaign to an Emailit audience.
 *
 * Admin-only, and deliberately synchronous: at Emailit's default 2 messages/sec
 * a 500-person list takes about four minutes, so this blocks the request that
 * long and reports the real outcome. Anything larger belongs in a queue — see
 * the note in the dashboard UI and README.
 */

import type { APIRoute } from 'astro';
import { currentUser, isAdmin } from '../../../lib/auth/session';
import { verifyCsrf } from '../../../lib/auth/csrf';
import { emailitConfigured, listSubscribers, sendCampaign } from '../../../lib/emailit/client';

export const prerender = false;

/**
 * Recipients above this are refused rather than silently taking many minutes
 * and probably tripping the daily cap.
 */
const MAX_RECIPIENTS = 500;

function redirect(params: Record<string, string>): Response {
	return new Response(null, {
		status: 303,
		headers: { Location: `/dashboard/marketing?${new URLSearchParams(params).toString()}` },
	});
}

export const POST: APIRoute = async (context) => {
	const user = await currentUser(context);

	if (!user) {
		return new Response(null, { status: 303, headers: { Location: '/login?next=/dashboard/marketing' } });
	}

	if (!isAdmin(user)) {
		return new Response('Not found', { status: 404 });
	}

	const form = await context.request.formData();

	if (!(await verifyCsrf(context, form.get('csrf')))) {
		return redirect({ error: 'Your session expired. Please try again.' });
	}

	if (!(await emailitConfigured())) {
		return redirect({ error: 'EMAILIT_API_KEY is not set on this server.' });
	}

	const audienceId = String(form.get('audience') ?? '').trim();
	const subject = String(form.get('subject') ?? '').trim();
	const html = String(form.get('html') ?? '').trim();

	if (!audienceId || !subject || !html) {
		return redirect({ error: 'Audience, subject and body are all required.' });
	}

	try {
		const subscribers = await listSubscribers(audienceId);
		const recipients = subscribers
			.filter((subscriber) => subscriber.email && subscriber.status !== 'unsubscribed')
			.map((subscriber) => ({ email: subscriber.email, name: subscriber.name }));

		if (recipients.length === 0) {
			return redirect({ error: 'That audience has no active subscribers.' });
		}

		if (recipients.length > MAX_RECIPIENTS) {
			return redirect({
				error: `That audience has ${recipients.length} subscribers, over the ${MAX_RECIPIENTS} limit for a synchronous send.`,
			});
		}

		const result = await sendCampaign({ subject, html, recipients });

		if (result.rateLimited) {
			return redirect({
				error: `Stopped at Emailit's rate limit after ${result.sent} of ${recipients.length}. The rest were not sent.`,
			});
		}

		if (result.failed.length > 0) {
			return redirect({
				notice: `Sent ${result.sent} of ${result.attempted}. ${result.failed.length} failed.`,
			});
		}

		return redirect({ notice: `Sent to ${result.sent} subscriber${result.sent === 1 ? '' : 's'}.` });
	} catch (error) {
		console.error('[emailit] campaign failed:', error);

		return redirect({ error: 'The campaign could not be sent. Check the server logs.' });
	}
};
