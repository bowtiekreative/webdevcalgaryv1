# WebDevCalgary MCP server

Full read/write access to the site: the lead queue, the published content and
the app settings. Speaks stdio, so an MCP client launches it — there is nothing
to run as a service.

## Configure

Environment only, and the same variables the Astro app already uses. A working
front end means a working server.

| Variable | Needed for |
|---|---|
| `WP_GRAPHQL_ENDPOINT` | everything — the REST origin is derived from it |
| `WP_SHARED_SECRET` | leads and settings. Must equal `APP_SHARED_SECRET` on the WordPress resource |
| `WP_APPLICATION_PASSWORD` | **content writes only**, as `user:xxxx xxxx xxxx xxxx xxxx xxxx` |

Without the application password the server still starts and every lead tool
works; the three content-write tools refuse with an explanation instead of
failing obscurely. Create one at **wp-admin → Users → Profile → Application
Passwords**.

## Register it

```bash
claude mcp add webdevcalgary \
  --env WP_GRAPHQL_ENDPOINT=https://cms.webdevcalgary.com/graphql \
  --env WP_SHARED_SECRET=… \
  -- node /absolute/path/to/mcp/src/index.js
```

Or in a client's config file:

```json
{
  "mcpServers": {
    "webdevcalgary": {
      "command": "node",
      "args": ["/absolute/path/to/mcp/src/index.js"],
      "env": {
        "WP_GRAPHQL_ENDPOINT": "https://cms.webdevcalgary.com/graphql",
        "WP_SHARED_SECRET": "…"
      }
    }
  }
}
```

## Tools

**Leads** — the callback queue.

| Tool | Does |
|---|---|
| `list_leads` | Queue, best score first. Filter by status, grade or search. |
| `get_lead` | One lead in full, by reference. |
| `update_lead` | Move through the pipeline, fix details, append call notes. |
| `qualify_lead` | Recompute score and grade from the answers, and save. |
| `create_lead` | Add someone who phoned in. Scored the same way. |
| `lead_stats` | Counts by status and by grade. |
| `qualification_model` | The weights this server applies. |

**Content** — reads over WPGraphQL, writes over core REST.

`list_content`, `get_content`, `create_content`, `update_content`,
`delete_content` across `projects`, `services`, `testimonials`, `posts`,
`pages`.

**Site** — `get_settings`, `site_health`.

## Two things it will not do

**Set a score directly.** `qualify_lead` recomputes from the answers using the
same weights as the website. The grade decides who gets called first, so a tool
that accepted a grade would let anything reorder the queue.

**Erase content by accident.** `delete_content` trashes. Permanent deletion
needs `force: true`, passed deliberately.

## The duplicated weights

`src/tools.js` carries its own copy of the scoring table from
`web/src/config.ts`. That is a real duplication and worth knowing about: this is
a separate package with no build step, and the website's config is TypeScript.
The tables are small and change rarely, and `qualification_model` returns the
weights so a caller can compare the two. If they drift, that tool is how you
find out.
