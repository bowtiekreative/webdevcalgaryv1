# Astro + Headless WordPress Boilerplate

Astro front end on headless WordPress, with **WPGraphQL** as the API and
**Meta Box** for custom fields.

```
┌──────────────────────────┐        GraphQL         ┌────────────────────────┐
│ WordPress + MySQL        │ ─────  POST /graphql ──▶│ Astro 7 (static build) │
│ · WPGraphQL              │                         │ · content-layer loader │
│ · Meta Box (metabox.io)  │                         │ · zod-validated data   │
│ · mu-plugins (this repo) │◀── deploy hook on save ─│ · static HTML output    │
└──────────────────────────┘                         └────────────────────────┘
     editors work here                                  visitors land here
```

WordPress is never public-facing: it redirects its own front end to the Astro
site, and every "View"/"Preview" link in wp-admin points there too.

## Layout

| Path | What it is |
| --- | --- |
| [docker-compose.yml](docker-compose.yml) | WordPress 6.8 + MySQL 8.4 + wp-cli for local dev |
| [scripts/wp-bootstrap.sh](scripts/wp-bootstrap.sh) | One-shot setup: installs core, plugins, permalinks, demo content |
| [scripts/migrate-prefix.sh](scripts/migrate-prefix.sh) | Rewrites the `app_` prefix across an existing database, after you change it in code |
| [wordpress/mu-plugins/](wordpress/mu-plugins/) | The whole WordPress side — post types, fields, GraphQL bridge, headless behaviour |
| [wordpress/bin/](wordpress/bin/) | wp-cli helper scripts, mounted into the container |
| [web/](web/) | The Astro site |
| [web/src/config.ts](web/src/config.ts) | Brand name, tagline, nav fallback and subscription plans — the only place with project-specific values |

## Making it yours

Everything project-specific is in two places:

1. **[web/src/config.ts](web/src/config.ts)** — site name, tagline, mark, nav
   fallback, plans. Reads `SITE_NAME` / `SITE_TAGLINE` from env, so the same
   build can be rebranded without a code change.
2. **The `app_` prefix** — post types (`app_project`), Meta Box field IDs
   (`app_project_client`), GraphQL types (`AppMediaItem`), PHP namespace
   (`App\…`) and constants (`APP_FRONTEND_URL`).

To change the prefix, rename it in `wordpress/mu-plugins/`, `web/src/lib/wp/`,
`web/scripts/mock-wp.mjs` and `wordpress/tests/schema-contract.php`, then rewrite
any existing database rows:

```bash
./scripts/migrate-prefix.sh app mystudio
```

WordPress looks content up by the literal `post_type` / `meta_key` strings, so
without that step existing posts and custom fields are orphaned. Run
`php wordpress/tests/schema-contract.php` afterwards — it fails loudly if the
code and the queries have drifted apart.

One gotcha: `docker-compose.yml` sets `name: app`, which is the Compose *project*
name and determines the volume names. Changing it points Compose at a brand new,
empty stack. Set `COMPOSE_PROJECT_NAME` in `.env` to stay attached to an existing
one.

The WordPress core files live in a Docker volume and are not versioned. Only the
must-use plugins are, which is the entire content model — see
[wordpress/README.md](wordpress/README.md).

## Quick start

Needs Docker (with the compose plugin) and Node ≥ 22.12.

```bash
cp .env.example .env
./scripts/wp-bootstrap.sh          # ~2 min: WordPress, WPGraphQL, Meta Box, demo content

cd web
cp .env.example .env               # already points at http://localhost:8080/graphql
npm install
npm run dev                        # http://localhost:4321
```

| | |
| --- | --- |
| Astro site | http://localhost:4321 |
| WordPress admin | http://localhost:8080/wp-admin (`admin` / `admin`) |
| GraphQL endpoint | http://localhost:8080/graphql |
| GraphiQL IDE | wp-admin → GraphQL → GraphiQL IDE |

### Without Docker

There is a mock GraphQL server that serves the same schema from fixtures, so the
front end can be worked on with no WordPress at all:

```bash
cd web
npm run mock                                                   # terminal 1
WP_GRAPHQL_ENDPOINT=http://localhost:8099/graphql npm run dev   # terminal 2
```

`npm run mock:validate` checks every query document in
[web/src/lib/wp/queries.ts](web/src/lib/wp/queries.ts) against that schema —
worth running after editing a query, since a typo'd field otherwise only shows
up as a build failure against real WordPress.

## How custom fields reach the front end

Meta Box fields are **not** in the WPGraphQL schema by default. Two community
bridges exist ([wp-graphql-metabox], [wp-graphql-mb]) but both are third-party
and have lagged WPGraphQL releases, so this repo ships its own:
[app-graphql-metabox.php](wordpress/mu-plugins/app-graphql-metabox.php).

It reads every registered field group and exposes each one as a single object
field, with the group's shared field-ID prefix stripped automatically:

```php
// wordpress/mu-plugins/app-fields.php
$meta_boxes[] = [
    'id'           => 'app_project_details',
    'post_types'   => [ 'app_project' ],
    'graphql_name' => 'projectDetails',
    'fields'       => [
        [ 'id' => 'app_project_client', 'name' => 'Client', 'type' => 'text' ],
        [ 'id' => 'app_project_year',   'name' => 'Year',   'type' => 'number' ],
    ],
];
```

becomes

```graphql
project(id: "northside-coffee", idType: SLUG) {
  title
  projectDetails {   # from graphql_name
    client           # app_project_client, common prefix stripped
    year             # Int, because Meta Box numbers step by 1
  }
}
```

Media fields resolve to a `AppMediaItem` (url, alt, dimensions, srcset), `post`
fields to a `AppPostRef` (title, slug, front-end path), cloned fields to lists,
and groups to nested object types. Values load lazily — a field absent from the
query costs no database read. Set `'graphql' => false` on a group or field to
hide it.

### Adding a field, end to end

1. Add it to a group in [app-fields.php](wordpress/mu-plugins/app-fields.php).
2. Add it to the matching query in [web/src/lib/wp/queries.ts](web/src/lib/wp/queries.ts).
3. Map it in the `build*` function and schema in [web/src/lib/wp/schema.ts](web/src/lib/wp/schema.ts).
4. Mirror it in [web/scripts/mock-wp.mjs](web/scripts/mock-wp.mjs) so `npm run mock:validate` stays honest.
5. Add it to the expectations in [wordpress/tests/schema-contract.php](wordpress/tests/schema-contract.php).

Step 3 is what makes a rename fail loudly: the zod schema runs during the build,
so a missing field is a build error rather than `undefined` in the page.

Because the bridge *derives* GraphQL names, nothing otherwise records that
`app_project_client` is queried as `client`. The contract check in step 5 closes
that gap — it loads the real mu-plugins against a WordPress stub and asserts the
derived schema matches the queries, no database or web server involved:

```bash
docker compose exec wordpress php /var/www/html/app-tests/schema-contract.php
# or, with any PHP 8.1+ on the host:
php wordpress/tests/schema-contract.php
```

## Dashboard, auth and billing

A signed-in area at `/dashboard`, on top of the same WordPress install. There is
**no WooCommerce and no WordPress e-commerce plugin** — Stripe and PayPal are
called directly.

| Concern | Where it lives |
| --- | --- |
| Identity | WordPress `wp_users`. Create users, set roles and reset passwords in wp-admin. |
| Credential check | [app-auth.php](wordpress/mu-plugins/app-auth.php) — `POST /wp-json/app/v1/auth/login` |
| Sessions | Astro's built-in session, holding only the user id |
| Subscription state | Five meta fields on the WordPress user, written **only** by webhooks ([app-billing.php](wordpress/mu-plugins/app-billing.php)) |
| Payments | Stripe Checkout + Billing Portal, PayPal Subscriptions API |
| Marketing email | Emailit, from `/dashboard/marketing` |
| Transactional email | Emailit, via a `wp_mail` override ([app-emailit.php](wordpress/mu-plugins/app-emailit.php)) |

The Astro *server* talks to WordPress over a shared secret
(`APP_SHARED_SECRET` = `WP_SHARED_SECRET`); the browser never sees it and never
calls those endpoints. Without it the auth API refuses every request, so the
dashboard fails closed rather than open.

### Rendering modes

Adding `@astrojs/node` did not make the marketing site dynamic. `output: 'static'`
with an adapter prerenders everything **except** routes that opt out with
`export const prerender = false` — which is only `/login`, `/dashboard/**` and
`/api/**`. The public pages are still plain HTML.

### Security decisions worth knowing

- **Only webhooks grant access.** A browser returning from Checkout proves
  nothing — the tab can be closed, and the redirect is forgeable. Stripe events
  are HMAC-verified against the raw body; PayPal events are verified via their
  API (a round trip, but skipping it would let anyone POST themselves a
  subscription).
- **Plans are resolved by key from [config.ts](web/src/config.ts)**, never by a
  price id from the form, so nobody can subscribe themselves to a cheaper price.
- **Roles are checked twice** — in [middleware.ts](web/src/middleware.ts) and
  again in the page. Admin-only routes 404 rather than 403, so they don't
  confirm they exist.
- **CSRF**: a per-session token on every state-changing form, on top of Astro's
  own `checkOrigin`. Sessions are regenerated on login to prevent fixation.
- **Failed logins** return one generic message, so the endpoint can't be used to
  discover which addresses are registered, and are rate limited per IP+login.

### Getting it running

```bash
# 1. One shared secret, same value in both files
openssl rand -hex 32          # -> APP_SHARED_SECRET in .env
                              # -> WP_SHARED_SECRET  in web/.env
docker compose up -d wordpress   # reload wp-config with the new constant

# 2. Sign in at http://localhost:4321/login with any WordPress account
```

Stripe, PayPal and Emailit keys are optional: without them the dashboard still
works, and the billing page says which provider is unconfigured instead of
failing at checkout. See [web/.env.example](web/.env.example) for every key.

For Stripe webhooks locally:

```bash
stripe listen --forward-to localhost:4321/api/billing/stripe-webhook
```

### The Emailit rate limit matters

New Emailit workspaces are capped at **2 messages/second and 5,000/day**.
Campaign sending is throttled to that and runs inline with the request, so a
500-recipient list holds the request open for about four minutes — which is why
sends above 500 are refused rather than silently truncated. For bigger lists,
move `sendCampaign()` into a background worker; the throttling in
[client.ts](web/src/lib/emailit/client.ts) is already separate from the route
for exactly that reason.

## Content model

| Type | GraphQL | Front-end route | Meta Box group |
| --- | --- | --- | --- |
| Pages | `pages` | `/[...slug]` (nested URIs preserved) | `hero`, `seo` |
| Posts | `posts` | `/blog/[slug]` | `seo` |
| Projects (`app_project`) | `projects` | `/work/[slug]` | `projectDetails`, `seo` |
| Services (`app_service`) | `services` | `/services/[slug]` | `serviceDetails`, `seo` |
| Testimonials (`app_testimonial`) | `testimonials` | rendered inline | `testimonialDetails` |

Taxonomies: `app_capability` (projects + services) and `app_industry`
(projects). Services show related projects by shared capability.

## Data flow in Astro

WordPress is read through a **content-layer loader**
([web/src/lib/wp/loader.ts](web/src/lib/wp/loader.ts)), not per-page fetches, so
each collection is queried once per build, validated against zod, and cached
between dev-server restarts. Pages use the ordinary collection API:

```astro
---
import { getCollection, render } from 'astro:content';

const projects = await getCollection('projects');
const { Content } = await render(projects[0]);   // WordPress HTML
---
```

WordPress HTML passes through [html.ts](web/src/lib/wp/html.ts) on the way in:
links back to WordPress become site-relative, `wp-content` URLs stay absolute,
images get `loading="lazy"`, and `target="_blank"` links get `rel="noopener"`.

### Seeing WordPress edits during development

Content-layer loaders run **once** when the dev server starts, and the result is
cached. Nothing polls the CMS, so out of the box you would edit a post, reload,
and still see the old content until you restarted the dev server.

[web/integrations/wp-dev-refresh.mjs](web/integrations/wp-dev-refresh.mjs) fixes
that with Astro's `refreshContent()`, via two paths:

| | How | Latency | Setup |
| --- | --- | --- | --- |
| **Polling** | Asks WordPress for a cheap fingerprint (ids + `modified` only) and refreshes when it changes | ≤ 5s | None — on by default |
| **Webhook** | WordPress POSTs to `/_refresh` on save, reusing the `BUILD_HOOK_URL` machinery | Immediate | `npm run dev:host` |

Polling needs nothing and is the default. The webhook needs the dev server bound
to all interfaces so the container can reach it, which is what `dev:host` does —
note that also exposes the dev server on your LAN, which is why plain `npm run
dev` stays localhost-only.

Tune or disable polling with `WP_DEV_POLL_MS` (`0` turns it off). Both paths are
dev-only; the integration adds nothing to a production build.

Not covered by the fingerprint: renaming a taxonomy term or editing a menu.
Those still want a dev-server restart.

### When WordPress is unreachable

The build **warns and continues** with whatever the previous build cached, so a
WordPress outage cannot take the site down. With nothing cached, pages render an
empty state explaining what is missing. In CI you almost certainly want the
opposite:

```bash
WP_FAIL_ON_ERROR=1 npm run build
```

The cache is Astro's content-layer store at
`web/node_modules/.astro/data-store.json` — note it survives deleting
`web/.astro`, which is worth knowing when a stale entry is confusing you:

```bash
rm web/node_modules/.astro/data-store.json    # force a full refetch
```

## Images

`WpImage.astro` emits a plain `<img>` using the `srcset` WordPress already
generated on upload. That is deliberate: optimising remote images means
downloading every upload at build time, so one 404 or a slow host breaks the
build.

`image.domains` in [astro.config.mjs](web/astro.config.mjs) is already set to the
WordPress host, so where build-time optimisation is worth it you can use
`astro:assets` directly:

```astro
---
import { Image } from 'astro:assets';
---
<Image src={project.data.hero.url} width={1600} height={1200} alt="" />
```

## Deployment

The front end is a static bundle — `npm run build` in `web/` produces `dist/`.

1. Host WordPress anywhere it can run PHP + MySQL (its own subdomain, e.g.
   `cms.bowtiekreative.com`). Keep `mu-plugins/` deployed with it.
2. Set `WP_GRAPHQL_ENDPOINT` and `SITE_URL` in the front-end host's env, plus
   `WP_FAIL_ON_ERROR=1`.
3. Put the host's deploy-hook URL in `BUILD_HOOK_URL` on the WordPress side.
   [app-headless.php](wordpress/mu-plugins/app-headless.php) POSTs to it whenever
   published content changes, so editors get a rebuild without leaving wp-admin.

### Draft previews

The WordPress side is wired up: `APP_FRONTEND_URL` and `APP_PREVIEW_SECRET` make
the Preview button point at `/api/preview` on the Astro site. Serving that route
needs on-demand rendering, which this static build does not have — add
`@astrojs/node` (or your host's adapter), an `/api/preview` endpoint that checks
the secret, and query WordPress with `WP_APPLICATION_PASSWORD` set so drafts are
visible. Until then Preview lands on the published version of the page.

## What has been verified

| Check | Command |
| --- | --- |
| PHP syntax, all 4 mu-plugins | `php -l wordpress/mu-plugins/*.php` |
| Derived schema matches the queries | `php wordpress/tests/schema-contract.php` |
| Query documents parse and execute | `cd web && npm run mock:validate` |
| Types | `cd web && npm run check` — 0 errors |
| Full build, 15 pages | `cd web && npm run build` against the mock server |

Also confirmed in the generated HTML: internal links rewritten to site-relative,
`wp-content` URLs left absolute, `loading="lazy"` added, `target="_blank"`
hardened with `rel="noopener"`, empty Meta Box groups falling back correctly, and
both failure modes (warn-and-continue vs `WP_FAIL_ON_ERROR=1`).

Now also verified end to end against a live stack (Docker + MySQL 8.4 +
WordPress 6.8 + WPGraphQL + Meta Box): field values written with `wp post meta`
come back through `/graphql` correctly typed — `year` as a real `Int`,
`featured` as a `Boolean`, cloned `deliverables` as a list, the testimonial's
`project` as a `AppPostRef` — and `npm run build` renders them into the HTML.

Two bugs only the live stack could surface, both fixed:

- **Unset numbers broke the field.** Meta Box stores an untouched number field
  as `''`, which cannot coerce to `Int`, so `projectDetails.year` returned
  `Internal server error`. Numerics now resolve through `to_number()`, and unset
  scalars return `null` instead of `''`.
- **Testimonials silently loaded as zero.** WPGraphQL treats a post type as
  private unless `public === true || publicly_queryable === true`, so the
  `public => false` testimonial type returned an empty list to the build with no
  error anywhere. It is now `public => true, publicly_queryable => false` — no
  front-end URL, but readable by GraphQL.

[wp-graphql-metabox]: https://github.com/hsimah-services/wp-graphql-metabox
[wp-graphql-mb]: https://github.com/DalkMania/wp-graphql-mb
