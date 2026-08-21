/**
 * Lead scoring.
 *
 * The funnel sells nothing self-serve, so the only thing the site produces is
 * conversations. This turns a form submission into a number and a grade, whose
 * single job is to sort the callback queue — call the hot ones today, work the
 * warm ones this week, drip the rest.
 *
 * Two deliberate properties:
 *
 *   - **Scored on the server, never in the browser.** The form posts choice
 *     *ids*; weights live in config.ts and are applied here. A tampered request
 *     cannot promote itself to hot, which matters because the grade decides who
 *     gets called first.
 *   - **Unknown ids score zero rather than throwing.** A stale cached form
 *     posting a retired option should still produce a lead — a real person is
 *     on the other end of it. The gap shows up as a lower score, not a 400.
 */

import {
	budgets,
	GRADE_HOT,
	GRADE_WARM,
	MAX_SCORE,
	roles,
	siteStates,
	timelines,
	trades,
	type Choice,
} from '../config';

export type Grade = 'hot' | 'warm' | 'cold';

export interface Answers {
	timeline?: string | null;
	budget?: string | null;
	role?: string | null;
	siteState?: string | null;
	trade?: string | null;
}

export interface Qualification {
	/** 0-100, normalised against the best possible answer set. */
	score: number;
	grade: Grade;
	/** Why it scored what it did, in the order the form asks. */
	breakdown: Array<{ field: string; choice: string; label: string; weight: number }>;
}

const FIELDS: Array<{ field: keyof Answers; options: Choice[] }> = [
	{ field: 'timeline', options: timelines },
	{ field: 'budget', options: budgets },
	{ field: 'role', options: roles },
	{ field: 'siteState', options: siteStates },
	{ field: 'trade', options: trades },
];

/** Look a choice up by id, tolerating anything unrecognised. */
export function choice(options: Choice[], id: string | null | undefined): Choice | null {
	return options.find((option) => option.id === id) ?? null;
}

export function qualify(answers: Answers): Qualification {
	const breakdown = FIELDS.map(({ field, options }) => {
		const picked = choice(options, answers[field]);

		return {
			field,
			choice: picked?.id ?? '',
			label: picked?.label ?? 'Not answered',
			weight: picked?.weight ?? 0,
		};
	});

	const total = breakdown.reduce((sum, row) => sum + row.weight, 0);
	// MAX_SCORE is derived from the same tables, so adding an option with a
	// bigger weight cannot silently push scores past 100.
	const score = MAX_SCORE > 0 ? Math.round((total / MAX_SCORE) * 100) : 0;

	return { score, grade: gradeFor(score), breakdown };
}

export function gradeFor(score: number): Grade {
	if (score >= GRADE_HOT) {
		return 'hot';
	}

	return score >= GRADE_WARM ? 'warm' : 'cold';
}

/** What the internal notification says to do about it. */
export function nextAction(grade: Grade): string {
	switch (grade) {
		case 'hot':
			return 'Call today. This one is ready.';
		case 'warm':
			return 'Call this week.';
		default:
			return 'Drip. Not in market yet.';
	}
}

/** Human summary for the notification email and the wp-admin column. */
export function summarise(q: Qualification): string {
	return q.breakdown
		.filter((row) => row.choice !== '')
		.map((row) => `${row.field}: ${row.label}`)
		.join('\n');
}
