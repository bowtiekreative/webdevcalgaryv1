# web — Astro front end

Static site built from headless WordPress over WPGraphQL. Architecture, content
model and the WordPress side are documented in [../README.md](../README.md).

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on http://localhost:4321 |
| `npm run dev:host` | Same, bound to all interfaces — lets the WordPress container POST to `/_refresh` for instant content updates |
| `npm run build` | Static build to `dist/` |
| `npm run preview` | Serve the built output |
| `npm run check` | `astro check` — types across `.astro` and `.ts` |
| `npm run mock` | Mock WPGraphQL server on :8099, so the front end runs with no WordPress |
| `npm run dev:mock` | Dev server pointed at the mock — pair with `npm run mock` in another terminal |
| `npm run build:mock` | Static build against the mock |
| `npm run mock:validate` | Validate every query document in `src/lib/wp/queries.ts` against the expected schema |

To see the site without installing anything:

```bash
npm run mock        # terminal 1
npm run dev:mock    # terminal 2 → http://localhost:4321
```

Copy `.env.example` to `.env` first. `WP_GRAPHQL_ENDPOINT` is the only required
variable.

## Where things live

```
src/
├── content.config.ts        Collections: pages, posts, projects, services, testimonials
├── lib/
│   ├── routes.ts            Sorting, date formatting, reserved slugs
│   └── wp/
│       ├── client.ts        GraphQL over fetch: retries, timeouts, auth, errors
│       ├── queries.ts       The query documents
│       ├── loader.ts        Content-layer loader (pagination, zod validation, caching)
│       ├── schema.ts        Zod schemas + GraphQL→entry normalisers
│       ├── html.ts          Cleans WordPress content HTML at build time
│       └── site.ts          Primary menu and general settings, memoised per build
├── layouts/BaseLayout.astro
├── components/
└── pages/
    ├── index.astro          Home (WordPress front page + featured work)
    ├── [...slug].astro      WordPress Pages, nested URIs preserved
    ├── work/                Projects
    ├── services/            Services
    ├── blog/                Posts
    └── rss.xml.ts
```

Data is read with the normal collection API — `getCollection('projects')` and
`render(entry)` for the WordPress HTML. Nothing fetches per page.

## Notes

- **Adding a field** touches `queries.ts` and `schema.ts` here, plus the
  WordPress side. The full checklist is in [../README.md](../README.md).
- **Images** use WordPress's own `srcset` via `WpImage.astro` rather than
  `astro:assets`, so a slow or 404-ing upload cannot break the build. See the
  comment in that file for when to opt into build-time optimisation instead.
- **A build with WordPress down** warns and reuses the cached store rather than
  failing. Use `WP_FAIL_ON_ERROR=1` in CI.
- **WordPress edits don't appear on reload** unless something re-runs the
  loaders — loaders run once at dev-server startup. `integrations/wp-dev-refresh.mjs`
  handles this by polling every 5s (`WP_DEV_POLL_MS=0` to disable) and by
  exposing `POST /_refresh` for WordPress to call. See [../README.md](../README.md).
- This project is on **Astro 7**, whose compiler rejects unclosed tags and
  applies JSX whitespace rules — adjacent inline elements need an explicit space
  between them.
