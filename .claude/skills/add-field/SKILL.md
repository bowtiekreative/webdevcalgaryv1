---
name: add-field
description: Add a Meta Box custom field to an existing content type across all five files it must appear in, then verify. Use when asked to add a field to projects, services, pages, posts or testimonials.
---

# Add a custom field

A field has to exist in five places. Miss one and it fails in a specific,
recognisable way — listed at the end.

## 1. Define it — `wordpress/mu-plugins/app-fields.php`

Add to the `fields` array of the right group. Keep the group's existing prefix:
the GraphQL bridge derives names by stripping the *longest shared prefix* across
the group, so an inconsistent id silently changes every other field's name too.

```php
[
    'id'   => 'app_project_budget',   // same app_project_ prefix as its siblings
    'name' => __( 'Budget', 'app' ),
    'type' => 'text',
],
```

Free Meta Box field types only, unless the user has a paid extension: `text`,
`textarea`, `number`, `url`, `email`, `select`, `checkbox`, `date`,
`single_image`, `image_advanced`, `file_advanced`, `post`, `taxonomy`. Add
`'clone' => true` for a repeatable.

The GraphQL name will be the id minus the shared prefix, camelCased —
`app_project_budget` becomes `budget`. Override with `'graphql_name' => '...'`.

## 2. Request it — `web/src/lib/wp/queries.ts`

Add the derived name inside the group's selection:

```graphql
projectDetails {
  client
  budget      # new
}
```

## 3. Validate it — `web/src/lib/wp/schema.ts`

Two edits, both required:

```ts
// a) the zod schema for the collection
budget: z.string().nullable(),

// b) the build* function that maps the GraphQL node
budget: details?.budget || null,
```

Zod is what makes a rename fail loudly at build time instead of rendering
`undefined`. Match the type to the field: `z.string()`, `z.number()`,
`z.boolean()`, `z.array(z.string())` for a clone, `mediaSchema` for an image.

## 4. Mirror it — `web/scripts/mock-wp.mjs`

Add to the SDL type **and** the fixtures, so the offline mock stays a real
second opinion:

```js
type AppProjectDetails {
  budget: String
}
// ...and in the fixture objects
projectDetails: { client: 'Northside', budget: '$12,000' }
```

## 5. Assert it — `wordpress/tests/schema-contract.php`

Add to `$expected_fields` for the group:

```php
'AppProjectDetails' => [
    'budget' => 'String',
],
```

## Type mapping

| Meta Box | GraphQL | zod | REST |
|---|---|---|---|
| text, textarea, url, select | `String` | `z.string().nullable()` | string |
| number (step 1) | `Int` | `z.number().nullable()` | integer |
| checkbox, switch | `Boolean` | `z.boolean()` | boolean |
| `clone => true` | `[String]` | `z.array(z.string())` | array |
| single_image | `AppMediaItem` | `mediaSchema.nullable()` | integer (attachment id) |
| image_advanced | `[AppMediaItem]` | `z.array(mediaSchema)` | array of integers |
| post | `AppPostRef` | object schema | integer |

REST exposure is automatic — `app-rest-fields.php` reads the same field
definitions, so there is nothing to add there.

## Verify

```bash
php wordpress/tests/schema-contract.php
cd web && npm run mock:validate && npm run check && npm run build
```

Then render it somewhere and confirm real data appears, or check
`/dashboard/health` for the field count on that type.

## If it goes wrong

| Symptom | Cause |
|---|---|
| Contract check says the field is missing | Prefix inconsistent with its siblings, changing the derived names |
| Build fails on the zod schema | Step 3b missing, or the wrong zod type |
| `mock:validate` fails | Step 4 missing |
| Always null with real data | Field id in `app-fields.php` differs from the meta key actually saved |
| Number field 500s in GraphQL | Meta Box stores an untouched number as `''`; resolve numerics to null when empty |
