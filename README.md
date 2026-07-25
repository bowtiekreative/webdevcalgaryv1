# Bow Tie Kreative

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
| [wordpress/mu-plugins/](wordpress/mu-plugins/) | The whole WordPress side — post types, fields, GraphQL bridge, headless behaviour |
| [web/](web/) | The Astro site |

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
[btk-graphql-metabox.php](wordpress/mu-plugins/btk-graphql-metabox.php).

It reads every registered field group and exposes each one as a single object
field, with the group's shared field-ID prefix stripped automatically:

```php
// wordpress/mu-plugins/btk-fields.php
$meta_boxes[] = [
    'id'           => 'btk_project_details',
    'post_types'   => [ 'btk_project' ],
    'graphql_name' => 'projectDetails',
    'fields'       => [
        [ 'id' => 'btk_project_client', 'name' => 'Client', 'type' => 'text' ],
        [ 'id' => 'btk_project_year',   'name' => 'Year',   'type' => 'number' ],
    ],
];
```

becomes

```graphql
project(id: "northside-coffee", idType: SLUG) {
  title
  projectDetails {   # from graphql_name
    client           # btk_project_client, common prefix stripped
    year             # Int, because Meta Box numbers step by 1
  }
}
```

Media fields resolve to a `BtkMediaItem` (url, alt, dimensions, srcset), `post`
fields to a `BtkPostRef` (title, slug, front-end path), cloned fields to lists,
and groups to nested object types. Values load lazily — a field absent from the
query costs no database read. Set `'graphql' => false` on a group or field to
hide it.

### Adding a field, end to end

1. Add it to a group in [btk-fields.php](wordpress/mu-plugins/btk-fields.php).
2. Add it to the matching query in [web/src/lib/wp/queries.ts](web/src/lib/wp/queries.ts).
3. Map it in the `build*` function and schema in [web/src/lib/wp/schema.ts](web/src/lib/wp/schema.ts).
4. Mirror it in [web/scripts/mock-wp.mjs](web/scripts/mock-wp.mjs) so `npm run mock:validate` stays honest.
5. Add it to the expectations in [wordpress/tests/schema-contract.php](wordpress/tests/schema-contract.php).

Step 3 is what makes a rename fail loudly: the zod schema runs during the build,
so a missing field is a build error rather than `undefined` in the page.

Because the bridge *derives* GraphQL names, nothing otherwise records that
`btk_project_client` is queried as `client`. The contract check in step 5 closes
that gap — it loads the real mu-plugins against a WordPress stub and asserts the
derived schema matches the queries, no database or web server involved:

```bash
docker compose exec wordpress php /var/www/html/btk-tests/schema-contract.php
# or, with any PHP 8.1+ on the host:
php wordpress/tests/schema-contract.php
```

## Content model

| Type | GraphQL | Front-end route | Meta Box group |
| --- | --- | --- | --- |
| Pages | `pages` | `/[...slug]` (nested URIs preserved) | `hero`, `seo` |
| Posts | `posts` | `/blog/[slug]` | `seo` |
| Projects (`btk_project`) | `projects` | `/work/[slug]` | `projectDetails`, `seo` |
| Services (`btk_service`) | `services` | `/services/[slug]` | `serviceDetails`, `seo` |
| Testimonials (`btk_testimonial`) | `testimonials` | rendered inline | `testimonialDetails` |

Taxonomies: `btk_capability` (projects + services) and `btk_industry`
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
   [btk-headless.php](wordpress/mu-plugins/btk-headless.php) POSTs to it whenever
   published content changes, so editors get a rebuild without leaving wp-admin.

### Draft previews

The WordPress side is wired up: `BTK_FRONTEND_URL` and `BTK_PREVIEW_SECRET` make
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
`project` as a `BtkPostRef` — and `npm run build` renders them into the HTML.

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
