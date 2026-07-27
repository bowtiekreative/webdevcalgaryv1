/**
 * Funnel copy that is not editable content.
 *
 * Testimonials, portfolio entries and blog posts come from WordPress. The
 * argument of the page — the problem cards, the comparison table, the FAQ —
 * lives here instead, because changing it is a positioning decision rather
 * than a content update, and it should show up in a diff when it happens.
 *
 * Voice rules (Design System.dc.html, section 06):
 *   Say — plain, direct, short sentences. Contractions always. Say the number
 *   out loud. Name the objection first. One restrained local nod at most.
 *   Never say — "solutions", "leverage", "elevate", "digital presence",
 *   "synergy", "contact us for pricing". No heavy Stampede/cowboy theming.
 */

export interface Card {
	heading: string;
	body: string;
	index?: string;
}

/** The four numbers under the hero. */
export const proofStrip = [
	{ figure: '20+ yrs', label: 'Building websites in Calgary' },
	{ figure: '120+', label: 'Businesses launched' },
	{ figure: '24 hrs', label: 'From start to live' },
	{ figure: 'Locked', label: 'Your price never rises' },
];

/** "The website isn't the problem. Nobody owning it is." */
export const problems: Card[] = [
	{
		index: '01',
		heading: 'Your hours are wrong',
		body: 'Prices changed, you added a service, someone left the team. It’s all still sitting there from three years ago.',
	},
	{
		index: '02',
		heading: 'Your web guy went quiet',
		body: 'You emailed twice. Nothing. Now you don’t even know who has the login, the domain, or the hosting.',
	},
	{
		index: '03',
		heading: 'Every edit costs you',
		body: '$150 and a two-week wait to change a phone number, so you stopped bothering. The site slowly went stale.',
	},
];

/** Straight comparison. First column is us; the highlight follows it. */
export const comparison = {
	columns: ['WebDevCalgary', 'Calgary agency', 'DIY builder'],
	rows: [
		{ label: 'Live in', values: ['24 hours', '6–12 weeks', '40+ hrs of your time'] },
		{ label: 'To start', values: ['$497 rush fee', '$3,000–$10,000', '$0'] },
		{ label: 'Monthly', values: ['$147, locked', '$150–$300 + change fees', '$30–60 + your labour'] },
		{ label: 'Changes', values: ['Unlimited, 48h', 'Billed hourly', 'You do them'] },
		{ label: 'Price increases', values: ['Never', 'Yes', 'Yes'] },
		{ label: 'You own it', values: ['Always', 'Sometimes', 'Yes'] },
		{ label: 'Someone answers', values: ['Yes', 'Depends', 'No'] },
	],
};

/** What the teardown usually turns up. */
export const teardownFindings: Card[] = [
	{
		index: 'Usually found',
		heading: 'The invisible stuff',
		body: 'A contact form that’s been silently failing. Hours that changed in 2023. A phone number that doesn’t tap-to-call on mobile.',
	},
	{
		index: 'Usually found',
		heading: 'The Google gap',
		body: 'Wrong categories, no services listed, three photos from 2019. Your competitor’s listing is winning calls you never knew existed.',
	},
	{
		index: 'Usually found',
		heading: 'The trust leaks',
		body: 'No reviews on the site, no photos of real work, an SSL warning on some browsers. Small things that make people call the next guy.',
	},
];

/** Post-purchase timeline on the thank-you page. */
export const nextSteps: Card[] = [
	{
		index: 'Now → 1 hr',
		heading: 'Check your inbox',
		body: 'Your go-live time in writing, plus a short intake — business details, photos if you have them, and what matters most to you.',
	},
	{
		index: 'Today',
		heading: 'We build',
		body: 'Copy, layout, photos, mobile, domain, SSL. You don’t need to do anything except answer the intake.',
	},
	{
		index: 'Tomorrow',
		heading: 'You’re live',
		body: 'Site launches on your domain. From then on: send any change, it’s done within 48 hours. Forever.',
	},
];

export interface Faq {
	question: string;
	answer: string;
}

export const faqs: Faq[] = [
	{
		question: 'Why a rush fee instead of a build fee?',
		answer:
			'Because that’s what you’re actually buying. The build is handled. What costs us something is dropping everything and getting your site live by tomorrow instead of next week. If tomorrow doesn’t matter to you, take the 7-day standard build and keep the $497.',
	},
	{
		question: 'How is this live in 24 hours?',
		answer:
			'Twenty years of doing this, plus we’ve automated the parts that used to take weeks. What’s left is the part that needs a person: getting it right for your business, and putting it live properly.',
	},
	{
		question: 'What does "unlimited changes" really mean?',
		answer:
			'Unlimited requests, handled one at a time, most within 48 hours. New page, seasonal promo, updated photos, changed hours — send it and it gets done. No change fee, no hourly clock. A full rebrand or an online store is a bigger job and gets quoted separately.',
	},
	{
		question: 'Who owns the website?',
		answer:
			'You do. The site, the domain, the content. If you ever leave, it comes with you. Nothing is held hostage.',
	},
	{
		question: 'Is there a contract?',
		answer:
			'No. Month to month, cancel any time, no penalty. The only thing locked is your price — and that’s locked in your favour.',
	},
	{
		question: 'What if I already have a website?',
		answer:
			'We replace it and keep what’s worth keeping — your domain, your rankings, your content. Nothing goes dark during the switch.',
	},
	{
		question: 'Why is this cheaper than an agency quote?',
		answer:
			'You’re not paying for a six-week project cycle, a sales team, or a downtown office. You’re paying for a website and someone who keeps it running.',
	},
	{
		question: 'Do you work outside Calgary?',
		answer: 'Airdrie, Okotoks, Cochrane, Chestermere and Strathmore, yes. Beyond that, ask.',
	},
];

/**
 * Testimonials shown before WordPress has any.
 *
 * Real quotes from real clients — the peer proof block is the thing that
 * closes, so an empty grid on first deploy would be worse than a stale one.
 * Once testimonials exist in wp-admin these are never rendered.
 */
export const fallbackTestimonials = [
	{
		quote:
			'They communicated often, made sure I was updated every step of the way. Well priced and always responsive to my questions, ideas and changes.',
		author: 'Anatoli Barbu',
		company: 'Barbu Entertainment',
	},
	{
		quote:
			'Excellent service that was also on time and on budget. It has increased my business and given me new leads for additional work.',
		author: 'Tony Masone',
		company: 'law firm',
	},
	{
		quote:
			'His work ethic is iron clad, and he researches the best tools to get things done even if it means coding something himself.',
		author: 'Anna Rounseville',
		company: null,
	},
	{
		quote:
			'Professional, asked the right questions and delivered on time. I would recommend them to family and friends!',
		author: 'Fred Diblasio',
		company: null,
	},
	{
		quote: 'Ryan was easy to work with and quick to respond. He makes it effortless and goes that extra mile.',
		author: 'Ahmed Rammay',
		company: null,
	},
	{
		quote: 'His methods of search engine optimization have already shown an increase in traffic to our site.',
		author: 'Ryan Verkley',
		company: null,
	},
];
