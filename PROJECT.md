# WebDevCalgary

The funnel at [webdevcalgary.com](https://webdevcalgary.com) — Astro front end on
headless WordPress, forked from
[bowtiekreative/boilerplate](https://github.com/bowtiekreative/boilerplate).

> [README.md](README.md) documents the framework this is built on and is still
> accurate. This file covers what is specific to WebDevCalgary. Conventions live
> in [AGENTS.md](AGENTS.md); the procedure for changing the design is in
> [BUILDING.md](BUILDING.md).

## The offer

| | Price | Where it is charged |
|---|---|---|
| 24-hour rush fee | $497 | PayPal Orders, `/checkout` |
| Split rush fee | 2 × $249 | PayPal Orders, `/checkout` |
| Website Teardown (tripwire) | $47 | PayPal Orders, `/teardown` |
| Google Business Profile Rescue (bump) | +$97 | PayPal Orders, `/checkout` |
| Website Rescue (downsell) | $297 | by phone |
| Core plan | $147/mo | PayPal Subscriptions |
| Growth plan | $497/mo | PayPal Subscriptions |

**Every one of those numbers lives in [web/src/config.ts](web/src/config.ts).**
The landing page, the checkout summary and the PayPal order all read the same
constants, so a price can only be changed in one place. The browser posts offer
*ids*, never amounts — `/api/billing/paypal-order` reprices the cart server-side
before it charges anything.

## The parts that are ours

| Path | What it is |
|---|---|
| [web/src/config.ts](web/src/config.ts) | Brand, contact, plans, offers, the guarantee's cutoff |
| [web/src/funnel.ts](web/src/funnel.ts) | Funnel argument — problem cards, comparison table, FAQ |
| [web/src/styles/global.css](web/src/styles/global.css) | The design system, ported from the design deck |
| [web/src/lib/orders.ts](web/src/lib/orders.ts) | References, the go-live deadline, records, notifications |
| [web/src/lib/billing/paypal-orders.ts](web/src/lib/billing/paypal-orders.ts) | One-time PayPal charges |
| [wordpress/mu-plugins/app-orders.php](wordpress/mu-plugins/app-orders.php) | Orders and leads as a wp-admin queue |

Pages: `/` (landing), `/teardown`, `/checkout`, `/thank-you`, `/work` (portfolio),
`/services`, `/blog`. The dashboard, docs and auth are inherited from the
boilerplate and untouched.

## Design rules, non-negotiable

From `Design system and funnel review/Design System.dc.html`, which is the spec:

- **Border radius is 0.** No gradients, no glassmorphism, no soft shadows. The
  only shadow is the offset "printed" one on primary buttons (`4px 4px 0`).
- **One bold element per page** — the dispatch clock. Everything else stays
  quiet so it lands.
- **Peer proof above authority proof, always.** Text testimonials from business
  owners close trades. The Norman Seeff / Renée Taylor / Jully Black
  endorsements reassure but do not close, and if they dominate a contractor
  reads "expensive, not for me" and leaves.
- **Sticky Call / Start bar on mobile.** The audience reads this on a phone, in
  a truck, between jobs.
- **No stock photography of smiling people in hardhats.** Real client sites,
  real screenshots, or nothing.

## Money flow

```
/checkout  ──POST offer ids──▶  /api/billing/paypal-order
                                      │ prices the cart from config.ts
                                      │ records an app-pending order
                                      ▼
                                 PayPal approval
                                      │
                                      ▼
                     /api/billing/paypal-return  ──capture──▶ PayPal
                                      │
                       COMPLETED ─────┴───── PENDING / failed
                          │                        │
        app-paid + go-live deadline          stays app-pending
        + confirmation and build emails      + "we'll email you"
                          │
                          ▼
                    /thank-you?ref=…
```

Only a `COMPLETED` capture counts as paid. The redirect back from PayPal proves
nothing on its own — anyone can visit that URL — so nothing is fulfilled off it.

## Deployment

Coolify at `https://cauziva.com`, project **WebDevCalgary**
(`q2h4n68fo8ctxjzmmrwr5kwv`), environment `production`, server `localhost`
(`v77gud1vzixsbejg9kqw3eze`, `212.1.213.81`).

| Resource | UUID | Build | Domain |
|---|---|---|---|
| `webdevcalgary-wordpress` | `drp4wlpdbsqst4qoi442h054` | compose, `/docker-compose.coolify.yml` | `cms.webdevcalgary.com` |
| `webdevcalgary-web` | `dhu40u5p8o1607y2l2f0qibn` | Dockerfile, base `/web` | `webdevcalgary.com` |

**The order matters and is not cosmetic.** The Astro site is prerendered, so
`npm run build` inside its Dockerfile queries WPGraphQL. WordPress has to be up,
bootstrapped and reachable at `WP_GRAPHQL_ENDPOINT` *before* the front end will
build at all — with `WP_FAIL_ON_ERROR=1` it fails the build rather than shipping
a site with no content.

That is why a fresh environment needs, in this order:

1. DNS: `webdevcalgary.com` and `cms.webdevcalgary.com` → `212.1.213.81`.
2. Deploy `webdevcalgary-wordpress`, wait for the certificate.
3. Run `scripts/wp-bootstrap.sh` against it — installs WPGraphQL and Meta Box
   and seeds the content model. Nothing works before this.
4. Deploy `webdevcalgary-web`.

GitHub Actions:

- **[ci.yml](.github/workflows/ci.yml)** — type-check and build against the mock
  WordPress server, lint the mu-plugins, run the schema contract, shellcheck.
- **[deploy.yml](.github/workflows/deploy.yml)** — on green CI for a commit on
  `main`, triggers the Coolify deploy and waits for it to actually finish.

Repository secrets it needs: `COOLIFY_URL`, `COOLIFY_TOKEN`, `COOLIFY_WEB_UUID`,
`COOLIFY_WORDPRESS_UUID`.

## Before this goes live

- [ ] **The 14 portfolio entries are seeded as drafts and must stay that way
      until they are real.** They are the fictional brands from the design deck,
      and the copy above them says "Sites we built. Sites we still maintain.
      These are live right now." Replace each with a real client, then publish.
- [ ] Legal pages (`/terms`, `/privacy`, `/refund-policy`) are seeded with
      placeholder copy and say so. Have them reviewed.
- [ ] Create the two PayPal billing plans and set `PAYPAL_PLAN_CORE` /
      `PAYPAL_PLAN_GROWTH`.
- [ ] Point `PAYPAL_ENV=live` only once a sandbox order has been taken
      end-to-end and the confirmation email arrived.
- [ ] Verify `webdevcalgary.com` in Emailit, then move `EMAILIT_FROM` onto it.
      Until then mail sends from `websites@bowtiekreative.com`.
- [ ] Register the PayPal webhook at `/api/billing/paypal-webhook` and set
      `PAYPAL_WEBHOOK_ID`.
