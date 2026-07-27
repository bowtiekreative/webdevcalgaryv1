---
name: verify-stack
description: Run every correctness check for this Astro + headless WordPress project and explain any failures. Use after changing custom fields, post types, GraphQL queries, or before committing.
---

# Verify the stack

Four checks, cheapest first. Stop at the first failure — a later check will
usually just restate an earlier one.

```bash
# 1. PHP syntax
php -l wordpress/mu-plugins/*.php wordpress/tests/*.php wordpress/bin/*.php

# 2. Do the derived GraphQL names still match what the queries ask for?
php wordpress/tests/schema-contract.php

# 3. Do the query documents match the schema?
cd web && npm run mock:validate

# 4. Types, then a real build
npm run check
npm run build
```

If PHP is not installed on the host, run 1 and 2 in the container:

```bash
docker compose exec wordpress php /var/www/html/app-tests/schema-contract.php
```

## Reading the failures

**`schema-contract.php` reports a missing field.** The field id in
`app-fields.php` and the name in `queries.ts` disagree. Remember the bridge
strips each group's shared prefix, so `app_project_client` is queried as
`client`. The script prints what the group *does* expose — use that name.

**`mock:validate` fails but the contract passed.** The query asks for something
the mock schema in `web/scripts/mock-wp.mjs` does not define. Add it there;
that file is a deliberate second source that catches drift.

**`npm run check` reports `Property 'data' does not exist on type 'unknown'`**
in a `[slug].astro`. `getStaticPaths` cannot infer prop types — declare an
explicit `interface Props`.

**`npm run build` warns about site mode.** WordPress is set to Coming soon or
Maintenance, so every prerendered page in this build is the gate page. Set it
back to Live in Settings → App Settings before deploying.

**A collection loads 0 entries.** Either WordPress is unreachable (the loader
warns and continues by design — `WP_FAIL_ON_ERROR=1` makes it fatal), or the
post type is not public and WPGraphQL is returning an empty list rather than an
error.

## Live check

For anything involving real data, keys or webhooks, sign in as an administrator
and open `/dashboard/health`. It compares database rows against GraphQL, REST
and the built collections, and makes real authenticated calls to Stripe, PayPal
and Emailit rather than reporting whether a value is merely present.

## Before saying it works

Report what you ran and what it printed. If you could not run something — no
Docker, no PHP, no credentials — say which check you skipped rather than
implying full coverage.
