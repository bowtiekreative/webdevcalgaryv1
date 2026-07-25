# WordPress side

Everything that defines the content model lives in [mu-plugins/](mu-plugins/).
They are must-use plugins, so they load automatically and cannot be deactivated
from the admin — the front-end build depends on them, so an accidental
deactivation would be a broken site rather than a broken page.

WordPress core and uploads are **not** versioned. Core lives in a Docker volume;
uploads are bind-mounted to `wordpress/uploads/` and git-ignored.

## Files

| File | Responsibility |
| --- | --- |
| [btk-post-types.php](mu-plugins/btk-post-types.php) | Registers `btk_project`, `btk_service`, `btk_testimonial` and the `btk_capability` / `btk_industry` taxonomies, all GraphQL-enabled |
| [btk-fields.php](mu-plugins/btk-fields.php) | Meta Box field groups |
| [btk-graphql-metabox.php](mu-plugins/btk-graphql-metabox.php) | Exposes those groups in the WPGraphQL schema |
| [btk-headless.php](mu-plugins/btk-headless.php) | Front-end redirects, admin link rewriting, CORS, deploy hook, `frontendPath` field |
| [tests/schema-contract.php](tests/schema-contract.php) | Asserts the derived GraphQL schema matches what the Astro queries expect |

`tests/` is mounted into the container at `/var/www/html/btk-tests` — outside
`wp-content`, so WordPress never tries to load it:

```bash
docker compose exec wordpress php /var/www/html/btk-tests/schema-contract.php
```

It stubs WordPress rather than booting it, so it is fast enough to run on every
change and works as a CI gate (non-zero exit on mismatch).

## Required plugins

Installed by `../scripts/wp-bootstrap.sh`, both free from wordpress.org:

- **WPGraphQL** (`wp-graphql`) — the API
- **Meta Box** (`meta-box`) — custom fields

`btk-headless.php` shows an admin notice if either is missing, because the
symptom otherwise is a silently incomplete schema.

WPGraphQL needs **pretty permalinks** for `/graphql` to resolve. The bootstrap
script sets them; if you install by hand, go to Settings → Permalinks and pick
anything other than Plain.

## Field types

[btk-fields.php](mu-plugins/btk-fields.php) uses only field types in the free
Meta Box plugin — `text`, `textarea`, `number`, `select`, `url`, `checkbox`,
`single_image`, `image_advanced`, `post`, and `clone => true` for repeatables.
No premium extension is needed to run this repo.

The GraphQL bridge also handles types from paid extensions if you add them later,
so no bridge changes are needed:

| Extension | Adds | Bridge output |
| --- | --- | --- |
| MB Group | `group` field type | Nested object type, recursive |
| MB Settings Page | Site-wide options | Not exposed — the bridge only handles post-backed groups |
| MB Relationships | Bi-directional relations | Not exposed — query via WPGraphQL's own connections |

Repeatable structured data without MB Group means several parallel `clone`
fields; if you find yourself doing that more than once, MB Group is worth buying.

## Naming rules for GraphQL

The bridge derives names automatically, but two things are worth knowing:

**Group names.** A group's GraphQL field is its `graphql_name`, falling back to a
camelCased `id`. Set it explicitly — it is part of the front-end contract.

**Field names.** The longest shared prefix across a group's field IDs is stripped
and the rest camelCased, so `btk_project_client` → `client`. The prefix is always
trimmed back to an underscore, so a partial word is never chopped, and a group
with a single field falls back to stripping `btk_`. Override per field with
`graphql_name` when you want something different.

Because names are derived, **renaming a field ID is a breaking change** for the
front end. Add `graphql_name` to pin the schema name if you need to rename the
underlying meta key without touching Astro.

## Post types and the schema

`register_post_type` needs three extra arguments for WPGraphQL:

```php
'show_in_graphql'     => true,
'graphql_single_name' => 'project',   // → root field `project`, type `Project`
'graphql_plural_name' => 'projects',  // → root field `projects`
```

These must be unique across the whole schema and must not collide with built-in
types (`Post`, `Page`, `MediaItem`, `Category`, `Tag`, `User`, `Menu`). That is
why the post type keys are prefixed `btk_` but the GraphQL names are not.

## Headless behaviour

`btk-headless.php` reads three constants, set by `docker-compose.yml` from the
root `.env` (set them in `wp-config.php` in production):

| Constant | Effect |
| --- | --- |
| `BTK_FRONTEND_URL` | Where the WordPress front end redirects to, and what admin View/Preview links point at. Unset ⇒ no redirects at all. |
| `BTK_PREVIEW_SECRET` | Shared secret appended to preview URLs |
| `BTK_BUILD_HOOK_URL` | POSTed to (non-blocking) when published content changes |

Redirects are 302, not 301 — the WordPress↔Astro mapping is configuration, and a
301 cached in editors' browsers is unpleasant to undo.

The path mapping lives in one place, `routed_post_types()`, and is also what
backs the `frontendPath` GraphQL field. If you add a post type with its own
route, add it there so WordPress and Astro agree on the URL.

## Debugging the schema

GraphiQL is the fastest check — wp-admin → GraphQL → GraphiQL IDE, or the
GraphiQL link this plugin adds to the admin bar. Its docs pane lists exactly
which fields the bridge registered.

If a Meta Box field is missing from the schema:

1. Is Meta Box active? (`rwmb_meta` must exist — the bridge no-ops without it.)
2. Is the group attached to `post_types`? Groups on settings pages, taxonomies or
   users are skipped by design.
3. Is the field type in `SKIPPED_FIELDS` (`heading`, `custom_html`, `divider`,
   `button`, `tab`, `nonce`)? Those carry no data.
4. Is `'graphql' => false` set on the group or field?
5. Check the derived name in GraphiQL before assuming it is absent — the prefix
   stripping may have named it something shorter than you expect.

WordPress debug log: `docker compose exec wordpress tail -f wp-content/debug.log`.
