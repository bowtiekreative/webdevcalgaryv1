# Notes for AI coding agents

Astro front end on headless WordPress. WPGraphQL for reads, Meta Box for custom
fields, Stripe/PayPal for subscriptions, Emailit for email. **No WooCommerce.**

Read this before editing. The rules below exist because breaking them produces
code that looks correct and fails silently.

Building a site with a supplied design? [BUILDING.md](BUILDING.md) is the
procedure: what to replace, the data contract, and deployment. This file is the
conventions. The shipped design is scaffolding — replacing it is expected.

## Verify with commands, never by reading

```bash
php wordpress/tests/schema-contract.php   # PHP field names vs the GraphQL queries
cd web
npm run mock:validate                     # every query document vs the schema
npm run check                             # types across .astro and .ts
npm run build                             # the whole thing
```

Run them before claiming anything works. `/verify-stack` does all of it and
explains the failures.

For a live end-to-end picture — database rows vs GraphQL vs REST vs what the
build actually contains, plus whether API keys and webhooks work — sign in as an
administrator and open `/dashboard/health`.

## The five rules

### 1. A custom field lives in five places

Meta Box names are *derived*: the bridge strips each group's shared prefix, so
`app_project_client` is queried as `client`. Nothing else records that mapping.
Change one file and not the rest and you get a field that exists in the schema
and is missing from the page.

| # | File | Role |
|---|------|------|
| 1 | `wordpress/mu-plugins/app-fields.php` | define |
| 2 | `web/src/lib/wp/queries.ts` | request |
| 3 | `web/src/lib/wp/schema.ts` | validate + normalise |
| 4 | `web/scripts/mock-wp.mjs` | keep the offline mock honest |
| 5 | `wordpress/tests/schema-contract.php` | assert the names still line up |

### 2. Prerendered pages have no request

Public pages are prerendered: no session, no cookies, no user — in `astro dev`
as well as production, and verified. Anything per-user needs
`export const prerender = false`. Adding a personalised element to a prerendered
page yields an empty result rather than an error.

### 3. Webhooks grant access; redirects do not

Subscription state is written **only** by the Stripe and PayPal webhook
handlers. A browser returning from checkout proves nothing — the tab can be
closed and the redirect is forgeable. Never mark a user subscribed because they
reached a success URL.

### 4. Configuration goes through `setting()`

`web/src/lib/settings.ts` resolves environment first, WordPress second. Never
hardcode a key, never log one, never send one to the browser. `X-App-Secret` is
server-to-server only.

### 5. Match the surrounding code

Tabs, single quotes, JSDoc on exported functions. Comments explain *why*, not
what. PHP is namespaced under `App\`, `declare(strict_types=1)`, WordPress
coding style.

## Layout

```
wordpress/mu-plugins/     the entire WordPress side, always-on plugins
  app-post-types.php      post types + taxonomies
  app-fields.php          Meta Box field groups          <- edit to add fields
  app-graphql-metabox.php Meta Box -> GraphQL            <- generic, rarely edit
  app-rest-fields.php     Meta Box -> REST               <- generic, rarely edit
  app-auth.php            credential check, user API
  app-billing.php         subscription state on the user
  app-settings.php        admin UI for keys + site mode
  app-emailit.php         wp_mail -> Emailit
  app-diagnostics.php     powers /dashboard/health
  app-headless.php        redirects, CORS, build hook
wordpress/tests/          schema contract check
wordpress/bin/            wp-cli helpers
web/src/
  config.ts               brand, plans, roles            <- edit to rebrand
  content.config.ts       collections
  middleware.ts           auth guards + maintenance gate
  lib/wp/                 GraphQL client, queries, schema, loader
  lib/auth/               sessions, CSRF, WordPress user API
  lib/billing/            Stripe, PayPal
  lib/emailit/            campaigns
  lib/health.ts           live stack check
  pages/                  routes; docs/ is public, dashboard/ is authed
```

## Traps

| Symptom | Cause |
|---|---|
| A collection loads zero items | WPGraphQL treats a post type as private unless `public` or `publicly_queryable` is true, and returns an empty list rather than an error |
| WordPress edits don't appear | Loaders run once at dev-server start; the dev integration polls every 5s, a build must be rerun |
| `rest_cannot_create` | Application passwords are refused over plain HTTP unless `WP_ENVIRONMENT_TYPE` is local |
| REST ignores custom fields | Post meta is invisible to REST until registered — `app-rest-fields.php` |
| Number field errors in GraphQL | Meta Box stores an untouched number as `''`, which cannot coerce to Int; resolve to null when empty |
| Whole site is a "coming soon" page | It was built while the site mode was not Live; the gate is baked in until the next build |
| `wp db query` fails | The wp-cli image ships a MariaDB client that cannot authenticate to MySQL 8 — use `wp eval` |
| Billing POST 404s | `WP_REST_Request` resolves parameters body-first; a body key can shadow a URL param. Use `get_url_params()` |
| Astro reports a useless error | Astro treats any thrown object with an `errors` array as an aggregate error and discards the message |

## Environment

Two files, and the environment always wins over WordPress:

- `.env` (root) — Docker, MySQL, `APP_SHARED_SECRET`, Emailit for WordPress mail
- `web/.env` — `WP_GRAPHQL_ENDPOINT`, `WP_SHARED_SECRET`, Stripe, PayPal, Emailit, branding

`APP_SHARED_SECRET` and `WP_SHARED_SECRET` must match. Keys can also be set in
wp-admin under Settings → App Settings, which is the supported way to rotate one
without a redeploy.

## Don't

- Add WooCommerce or any WordPress e-commerce plugin.
- Store subscription state anywhere but the WordPress user meta, via the webhooks.
- Trust a Meta Box field name you have not confirmed with the schema contract check.
- Claim something works without running the commands above.
- Commit `.env`, or print a secret into logs or HTML.
