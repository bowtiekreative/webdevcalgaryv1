---
name: add-content-type
description: Add a new WordPress post type end to end — registration, custom fields, GraphQL, REST, Astro collection, routes and tests. Use when asked to add a new kind of content such as events, team members, case studies or products.
---

# Add a content type

Nine files. Work in this order — later steps depend on names fixed earlier.

Throughout, `<thing>` is the singular lowercase name (`event`) and `<things>`
the plural (`events`).

## 1. Register it — `wordpress/mu-plugins/app-post-types.php`

```php
register_post_type(
    'app_event',
    [
        'labels'              => [ 'name' => __( 'Events', 'app' ), 'singular_name' => __( 'Event', 'app' ) ],
        'public'              => true,
        'publicly_queryable'  => true,
        'has_archive'         => true,
        'menu_icon'           => 'dashicons-calendar-alt',
        'supports'            => [ 'title', 'editor', 'excerpt', 'thumbnail', 'revisions', 'custom-fields', 'page-attributes' ],
        'rewrite'             => [ 'slug' => 'events', 'with_front' => false ],
        'show_in_rest'        => true,
        'rest_base'           => 'events',
        'show_in_graphql'     => true,
        'graphql_single_name' => 'event',
        'graphql_plural_name' => 'events',
    ]
);
```

**`public` must be true**, even for a type with no page of its own. WPGraphQL
treats a post type as private unless `public` or `publicly_queryable` is true,
and a private type returns an **empty list rather than an error** — the single
worst failure mode in this stack. If it should have no front-end URL, use
`'public' => true` with `'publicly_queryable' => false`.

GraphQL names must be unique across the whole schema and must not collide with
built-ins (`Post`, `Page`, `MediaItem`, `Category`, `Tag`, `User`, `Menu`).

Bump `$version` in `maybe_flush_rewrites()` so permalinks are flushed.

## 2. Fields — `wordpress/mu-plugins/app-fields.php`

```php
$meta_boxes[] = [
    'id'           => 'app_event_details',
    'title'        => __( 'Event Details', 'app' ),
    'post_types'   => [ 'app_event' ],
    'graphql_name' => 'eventDetails',
    'fields'       => [
        [ 'id' => 'app_event_starts', 'name' => __( 'Starts', 'app' ), 'type' => 'datetime' ],
        [ 'id' => 'app_event_venue',  'name' => __( 'Venue', 'app' ),  'type' => 'text' ],
    ],
];
```

Keep one consistent prefix per group — names are derived by stripping the
longest shared prefix. Add the new type to the `app_seo` group's `post_types`
if it gets its own page.

GraphQL and REST exposure are automatic from here.

## 3. Query it — `web/src/lib/wp/queries.ts`

Copy `PROJECTS_QUERY`, rename, and adjust the group selection. Keep
`$first`/`$after` — the loader paginates.

## 4. Schema — `web/src/lib/wp/schema.ts`

Add `eventSchema` and `buildEvent()`, modelled on the project pair. `buildEvent`
returns `{ id, data, html }`; `id` is the slug, since routes use it.

## 5. Collection — `web/src/content.config.ts`

```ts
const events = defineCollection({
	loader: wpLoader({
		label: 'events',
		query: EVENTS_QUERY,
		select: (data) => data?.events,
		build: buildEvent,
	}),
	schema: eventSchema,
});

export const collections = { pages, posts, projects, services, testimonials, events };
```

## 6. Routes — `web/src/pages/events/`

`index.astro` and `[slug].astro`, copied from `work/`. Dynamic routes need an
explicit `interface Props` — `getStaticPaths` cannot infer them.

Add the first path segment to `RESERVED_SLUGS` in `web/src/lib/routes.ts` so the
WordPress page catch-all does not fight it.

## 7. Front-end path — `wordpress/mu-plugins/app-headless.php`

Add to `routed_post_types()`:

```php
'app_event' => '/events',
```

That drives redirects, admin View links, the `frontendPath` GraphQL field and
the REST `frontend_path` field.

## 8. Mock — `web/scripts/mock-wp.mjs`

SDL type, connection, `Query` field, root resolver and at least two fixtures.
Make one fixture sparse (empty fields, no image) — that is what catches missing
null handling.

## 9. Tests — `wordpress/tests/schema-contract.php`

Add the type to `$expected_groups` and the field types to `$expected_fields`.

Also add it to `COLLECTIONS` in `web/src/lib/health.ts` so it appears in the
health check's mapping table, and to the fingerprint query in
`web/integrations/wp-dev-refresh.mjs` so dev-server auto-refresh notices it.

## Verify

```bash
php wordpress/tests/schema-contract.php
cd web && npm run mock:validate && npm run check && npm run build
```

Then, with WordPress running:

```bash
docker compose run --rm -T wpcli post create --post_type=app_event \
  --post_title="Test Event" --post_status=publish
```

Rebuild and confirm the row appears in `/dashboard/health` with matching counts
across DB, GraphQL, REST and Collection.

## Checklist

- [ ] `public => true`, or the collection silently loads zero items
- [ ] GraphQL single/plural names unique and non-colliding
- [ ] Rewrite version bumped
- [ ] Consistent field prefix within the group
- [ ] Route slug in `RESERVED_SLUGS`
- [ ] `routed_post_types()` updated
- [ ] Mock has a sparse fixture
- [ ] Contract expectations added
- [ ] Health mapping and dev-refresh fingerprint updated
