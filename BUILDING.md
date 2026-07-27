# Building a site on this framework

For an AI agent or a developer who has **their own HTML/CSS design** and wants to
wire it up to headless WordPress.

The design that ships with this repo is scaffolding. It exists so the plumbing
can be tested end to end — it is **meant to be deleted**. Nothing below the
design layer cares what your markup looks like.

> Conventions and rules live in [AGENTS.md](AGENTS.md). This file is the
> procedure. Read both.

---

## 1. What you are working with

```
Your HTML/CSS  ──▶  Astro components  ──▶  content collections  ──▶  WordPress
   (you write)        (you write)          (already built)        (already built)
```

You write the top two layers. The bottom two already work: WordPress stores the
content, a GraphQL loader pulls it into typed, validated collections, and your
components read those collections. You never write a fetch call.

**Delete freely** — nothing outside this list imports it:

| Path | What it is |
|---|---|
| `web/src/styles/global.css` | Design tokens and base styles |
| `web/src/styles/dashboard.css` | Dashboard-only styles |
| `web/src/components/*.astro` | Cards, header, footer, SEO tags |
| `web/src/layouts/BaseLayout.astro` | Public page shell |
| `web/src/layouts/DocsLayout.astro` | Docs shell |
| `web/src/pages/index.astro`, `work/`, `services/`, `blog/`, `[...slug].astro` | Public pages |

**Do not touch** unless you are deliberately changing behaviour — this is the
part that is tested and easy to break silently:

| Path | Why |
|---|---|
| `web/src/lib/wp/` | GraphQL client, queries, loader, schema |
| `web/src/lib/auth/`, `web/src/middleware.ts` | Sessions, route guards, maintenance gate |
| `web/src/lib/billing/`, `web/src/lib/emailit/` | Payments and email |
| `web/src/content.config.ts` | Collection definitions |
| `wordpress/mu-plugins/` | The whole content model |

`web/src/pages/dashboard/` and `web/src/pages/docs/` are functional rather than
decorative. Restyle them if you like, but they are not the marketing site.

---

## 2. Bringing your own design

### Step 1 — Get the static design rendering, with no data

Drop your CSS into `web/src/styles/` and your images into `web/public/`. Replace
`BaseLayout.astro` with your shell, hardcoding everything for now:

```astro
---
// web/src/layouts/BaseLayout.astro
import '../styles/your-design.css';
import Seo from '../components/Seo.astro';
import type { Seo as SeoData } from '../lib/wp/schema';

interface Props {
	title: string;
	description?: string | null;
	seo?: SeoData | null;
}

const { title, description, seo } = Astro.props;
---

<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<Seo title={title} description={description} seo={seo} />
	</head>
	<body>
		<!-- your header markup -->
		<main><slot /></main>
		<!-- your footer markup -->
	</body>
</html>
```

Keep `<Seo />` — it handles canonical URLs, Open Graph and the `noindex` flag
that editors set in WordPress. Everything else in the shell is yours.

Run `npm run dev` and get the design looking right with placeholder content
before wiring any data in. Debugging markup and data at the same time is what
makes this slow.

**Astro 7 gotchas that will bite you first:**

- Every non-void tag must be closed. The compiler is strict and errors rather
  than repairing your HTML.
- `compressHTML` defaults to JSX whitespace rules, so
  `<span>a</span><em>b</em>` renders as `ab`. Put an explicit space between
  adjacent inline elements.
- Class attributes on components need `class` (not `className`).

### Step 2 — Replace hardcoded content with collection data

```astro
---
import { getCollection, render } from 'astro:content';

const projects = await getCollection('projects');
const [first] = projects;
const { Content } = await render(first);   // WordPress HTML as a component
---

<h1>{first.data.title}</h1>
<p>{first.data.summary}</p>
<Content />
```

`entry.data` is validated at build time. Ask for a field that does not exist and
the build fails with a clear message instead of rendering `undefined`.

Rendered WordPress HTML arrives already tidied: internal links rewritten to
site-relative, `wp-content` URLs left absolute, `loading="lazy"` added, and
`target="_blank"` hardened with `rel="noopener"`. Give it a wrapper class and
style the tags inside — the shipped `.prose` styles in `global.css` are a
starting point you can replace.

### Step 3 — Wire up the routes

Route files own the URL structure. `getStaticPaths` needs an explicit
`interface Props` — it cannot infer them:

```astro
---
import type { GetStaticPaths } from 'astro';
import type { CollectionEntry } from 'astro:content';
import { getCollection, render } from 'astro:content';

interface Props {
	project: CollectionEntry<'projects'>;
}

export const getStaticPaths: GetStaticPaths = async () => {
	const projects = await getCollection('projects');

	return projects.map((project) => ({
		params: { slug: project.id },
		props: { project },
	}));
};

const { project } = Astro.props;
const { Content } = await render(project);
---
```

If you change a URL (say `/work/` becomes `/projects/`), update two other
places or links will point at the old path:

1. `routed_post_types()` in `wordpress/mu-plugins/app-headless.php`
2. `RESERVED_SLUGS` in `web/src/lib/routes.ts`

### Step 4 — Images

`WpImage.astro` emits a plain `<img>` using the `srcset` WordPress generated on
upload. That is deliberate: optimising remote images means downloading every
upload at build time, so one 404 or a slow host breaks the build.

If you want build-time optimisation for a specific spot, `image.domains` in
`astro.config.mjs` is already set to your WordPress host:

```astro
---
import { Image } from 'astro:assets';
---
<Image src={project.data.hero.url} width={1600} height={1200} alt="" />
```

---

## 3. The data contract

Every collection entry is `{ id, data, ... }`, where `id` is the slug and
`data` is validated. `render(entry)` returns `{ Content }` for the body HTML.

### Shared shapes

```ts
Media  { id, url, alt, title, caption, width, height, srcset, mimeType }
Term   { name, slug }
Seo    { title, description, image: Media|null, noindex: boolean }
```

### On every content entry

```ts
databaseId, slug, title, path, summary,
date, modified,            // ISO strings or null
featuredImage: Media|null,
seo: Seo
```

`path` is the front-end URL for that entry, computed by WordPress — use it for
links rather than rebuilding it.

### Per collection

| Collection | Additional fields |
|---|---|
| `pages` | `uri`, `isFrontPage`, `hero: { eyebrow, heading, subheading, ctaLabel, ctaUrl, image } \| null` |
| `posts` | `author`, `categories: Term[]`, `tags: Term[]` |
| `projects` | `menuOrder`, `client`, `year`, `role`, `deliverables: string[]`, `externalUrl`, `featured`, `hero: Media\|null`, `gallery: Media[]`, `capabilities: Term[]`, `industries: Term[]` |
| `services` | `menuOrder`, `tagline`, `icon`, `bullets: string[]`, `startingPrice`, `capabilities: Term[]` |
| `testimonials` | `menuOrder`, `quote`, `author`, `role`, `company`, `rating`, `photo: Media\|null`, `project: { databaseId, title, slug, path } \| null` |

Text fields are `string | null` — an untouched WordPress field is `null`, not
`""`. Sort helpers are in `web/src/lib/routes.ts`.

### Site-wide values

```astro
---
import { getSiteMeta, getPrimaryNav } from '../lib/wp/site';

const meta = await getSiteMeta();   // { title, description } from WordPress
const nav = await getPrimaryNav();  // [{ label, href, external }]
---
```

Navigation comes from the WordPress menu assigned to the **PRIMARY** location,
falling back to `fallbackNav` in `web/src/config.ts`. Both are memoised, so
calling them in a component costs one request per build, not one per page.

Brand values live in `web/src/config.ts` and read `SITE_NAME` / `SITE_TAGLINE`
from the environment — set them there rather than hardcoding a name in markup.

---

## 4. Changing the content model

Two skills automate the multi-file parts. In Claude Code:

| Skill | Use |
|---|---|
| `/add-content-type` | A new post type end to end — nine files, in order |
| `/add-field` | One custom field across the five places it must appear |
| `/verify-stack` | Run every check and interpret the failures |

The five-places rule matters because Meta Box names are *derived*: the bridge
strips each group's shared prefix, so `app_project_client` is queried as
`client`. Nothing records that mapping, so changing one file and not the others
gives you a field that exists in the schema and is missing from the page.

To remove the demo types entirely: delete their blocks from
`app-post-types.php` and `app-fields.php`, their queries and schemas under
`web/src/lib/wp/`, their entries in `content.config.ts`, their route files, and
their expectations in `wordpress/tests/schema-contract.php`. Then run
`./scripts/migrate-prefix.sh` if you are also changing the prefix.

---

## 5. Verify before you claim it works

```bash
php wordpress/tests/schema-contract.php   # PHP names vs the GraphQL queries
cd web
npm run mock:validate                     # queries vs the schema
npm run check                             # types
npm run build                             # the whole thing
```

Then sign in as an administrator and open `/dashboard/health`. It compares
database rows against GraphQL, REST and what the build actually contains, and
makes real authenticated calls to Stripe, PayPal and Emailit. Every row green
means the chain works end to end.

You can work with no WordPress at all:

```bash
npm run mock        # terminal 1 — serves the same schema from fixtures
npm run dev:mock    # terminal 2
```

---

## 6. Deploying on Coolify

Two resources, deployed in this order. The order is not optional: the site is
**prerendered**, so building the front end queries WordPress. WordPress must
already be up and have a domain first.

### Resource 1 — WordPress + MySQL

**New Resource → Docker Compose**, pointed at
[`docker-compose.coolify.yml`](docker-compose.coolify.yml).

Assign a domain to the `wordpress` service — say `cms.example.com`. It listens
on port 80, so a domain is all the proxy needs.

Set these environment variables in Coolify (anything marked `:?` in the compose
file blocks deployment until it has a value):

| Variable | Value |
|---|---|
| `FRONTEND_URL` | `https://example.com` — your public site |
| `APP_SHARED_SECRET` | `openssl rand -hex 32` |
| `EMAILIT_API_KEY` | Optional, for password-reset email |
| `EMAILIT_FROM` | Optional, e.g. `Studio <hello@example.com>` |

`SERVICE_PASSWORD_MYSQL`, `SERVICE_PASSWORD_MYSQLROOT`,
`SERVICE_PASSWORD_PREVIEW` and `SERVICE_FQDN_WORDPRESS` are Coolify magic
variables — it generates and stores them, so leave them alone.

Deploy, then finish WordPress at `https://cms.example.com/wp-admin`:

1. Complete the install.
2. Install and activate **WPGraphQL** and **Meta Box**.
3. Settings → Permalinks → anything but Plain. WPGraphQL needs pretty
   permalinks for `/graphql` to resolve.

### Resource 2 — the Astro front end

**New Resource → Dockerfile**, same repository, base directory `web`,
Dockerfile `web/Dockerfile`, port `4321`. Assign your public domain.

These must be set as **build** variables, not just runtime ones — the site is
prerendered, so they are read while the image builds:

| Variable | Value |
|---|---|
| `WP_GRAPHQL_ENDPOINT` | `https://cms.example.com/graphql` |
| `WP_SHARED_SECRET` | Same value as `APP_SHARED_SECRET` above |
| `SITE_URL` | `https://example.com` |
| `SITE_NAME`, `SITE_TAGLINE` | Your branding |
| `STRIPE_*`, `PAYPAL_*`, `EMAILIT_*` | Only if you are using them |

If a build fails with *"Could not reach WordPress"*, the endpoint is wrong or
the secret does not match. That is `WP_FAIL_ON_ERROR=1` doing its job — without
it you would deploy an empty site.

The runtime image is around 900 MB, most of it `node_modules` for the Node
adapter. That is unremarkable for a Node image and it starts in seconds, but if
you care, the front end is a normal static build: point Coolify's **Static**
build pack at `web/dist/client` instead and drop the dashboard. You lose
`/login`, `/dashboard`, `/api/**` and the instant maintenance gate on dynamic
routes — everything that needs a server.

### Rebuild when content changes

The front end is static, so publishing a post has to trigger a rebuild.

1. In the front-end resource, copy the deploy webhook —
   `https://coolify.example.com/api/v1/deploy?uuid=<resource-uuid>`.
2. Create an API token with the **deploy** permission under
   Settings → API Tokens.
3. In WordPress: **Settings → App Settings → Deploy hook**, paste the URL and
   the token.

Coolify's deploy endpoint requires `Authorization: Bearer <token>`, which is
why there is a token field — unlike Netlify and Vercel build hooks, which are
unauthenticated URLs and need the token field left blank.

Publishing content, or switching the site mode, now redeploys the front end
automatically.

### Checks before going live

- Set the site mode to **Live** before the final build. Building while it is
  Coming Soon bakes the gate page into every prerendered file. The build prints
  a warning if you do.
- `WP_ENVIRONMENT_TYPE` is `production` in the Coolify compose file. Over HTTPS,
  application passwords work; on plain HTTP they are refused.
- Point Stripe and PayPal webhooks at
  `https://example.com/api/billing/stripe-webhook` and
  `.../paypal-webhook`, then confirm on `/dashboard/health` that both report
  registered endpoints.
- Uploads live in the `wp_uploads` volume. Back it up along with the database.

### Deploying elsewhere

Nothing here is Coolify-specific. Any host that can build a Dockerfile works the
same way: WordPress first with a public GraphQL endpoint, then the front end
with build-time environment variables, then a deploy hook wired back into
WordPress. For Netlify or Vercel, build `web/` with `npm run build` and put the
build hook URL in the same settings field with the token left blank.
