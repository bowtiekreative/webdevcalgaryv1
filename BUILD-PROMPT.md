# Reusable build prompt — design deck → Astro + headless WordPress

Copy the block below into a fresh Claude Code session, fill in the `«...»`
placeholders, and point it at a repo containing the boilerplate and the design
material.

Everything after the prompt is the reasoning behind it: what goes wrong on
these builds, and why each instruction is there. Read that part before you
change the prompt.

---

## The prompt

````text
Build «SITE NAME» on the bowtiekreative/boilerplate stack (Astro + headless
WordPress + PayPal + Emailit, deployed on Coolify).

SOURCE MATERIAL
  «path to the design/strategy folder»
Read every file in it before writing any code — including the ones that look
like duplicates or exports. Tell me what's in there and what you plan to do
with each file before you start. If a file is a complete design rather than
notes, say so; those get converted, not reinterpreted.

TARGET
  Repo:     «github.com/org/repo»          (fork the boilerplate, keep history,
                                            keep it as an `upstream` remote)
  Domain:   «example.com»                   CMS on «cms.example.com»
  Coolify:  «https://coolify.host»  token in «...»
  Payments: «PayPal | Stripe»  — «what is sold, one-time vs recurring»
  Email:    Emailit, sending domain «verified-domain.com»

WHAT I CARE ABOUT

1. The design deck is the spec, not a suggestion. If it says radius 0, no
   gradients, one bold element per page — that is a positioning decision about
   who this sells to. Port it as design tokens. Do not "improve" it.

2. Prices and offers live in exactly one file. The browser posts product *ids*;
   the server resolves the amount. A tampered request must buy the same thing at
   the same price. Only a completed capture counts as paid — a redirect back
   from the payment provider proves nothing.

3. Never ship a claim that isn't true. If the deck's portfolio is fictional
   brands, they do not go live under copy that says "clients we still
   maintain" — seed them as drafts or label them as demonstrations, and tell me
   which you did. Same for placeholder legal pages. Flag every one of these
   rather than quietly resolving it.

4. Verify in production, not just locally. A local dev server does not reproduce
   TLS termination, proxy headers, or CDN routing. After deploying, actually
   exercise the forms and the payment path against the live domain and show me
   the results.

5. Report honestly. If something is blocked, say so plainly and say what it
   blocks. Do not describe partial work as finished.

DELIVERABLES
  - Working site deployed, with CI and an automated deploy on green CI
  - A PROJECT.md covering the offer, the money flow, the deploy order, and a
    "before this goes live" checklist of everything still outstanding
  - Every secret I gave you set where it belongs, and a note on any I should
    rotate or scope down
````

---

## Why each instruction is there

### "Read every file before writing any code"

This is the one that cost the most on the WebDevCalgary build. The source folder
contained fourteen files named `Portfolio - <Industry>.dc.html`. Read quickly,
they look like portfolio *entries* — a brand name, a trade, a year. They are
not. Each is a **complete, separate website**, with its own font pairing, its own
palette, and its own sections. Only Hero / Nav / Trust strip / Reviews appear in
all fourteen; the rest are industry-specific — Hail claims, Snow, Menu, Practice
areas, New patients.

Treating them as metadata and rendering them through one shared case-study
template threw away the entire point of the deliverable, and it had to be redone.

The check that would have caught it in thirty seconds:

```bash
# Do these files share a structure, or are they different designs?
grep -o 'data-screen-label="[^"]*"' *.dc.html | sort | uniq -c
grep -o "font-family:'[^']*'" *.dc.html | sort -u
```

If the section lists and the fonts diverge, they are separate designs. Convert
them. If they converge, they are one template with different content — then, and
only then, parameterise.

### "Convert, don't reinterpret"

For a complete design, a mechanical conversion beats a careful reimplementation.
It cannot drift from the source, it takes an hour instead of a day, and the
diff is reviewable.

On this build that meant a script that stripped the design tool's wrappers,
turned its `style-hover` / `style-focus` attributes into real CSS rules,
repointed internal links, and emitted static HTML into `public/`. No compiler in
the path, so the markup is guaranteed identical to the deck.

Watch for tool-specific syntax before you commit to this — template
placeholders, loops, embedded scripts. If they are present the file is a
component, not a page, and needs real work. Check first:

```bash
grep -c '{{\|<sc-for\|<sc-if\|data-dc-script' *.dc.html
```

### "Prices in one file, ids over the wire"

The failure this prevents is not theoretical: if the client posts an amount, the
client can post any amount. Keep a single `config.ts` with the offer catalogue,
have the checkout post `{offers: ['rush', 'gbp']}`, and price the cart
server-side.

The second half matters just as much. Creating a payment order is free and
proves nothing — anyone can hit the return URL by hand. Fulfilment hangs off the
capture result and a `COMPLETED` status, never off the redirect.

### "Never ship a claim that isn't true"

Design decks are full of plausible fiction — invented brands, sample
testimonials, lorem legal pages. The moment it deploys, it reads as a factual
claim about a real business.

The rule that works: **fiction ships as draft or ships labelled.** On this build
the fourteen demo sites ship labelled — a banner on every page saying the
business is not real, plus `noindex` so they cannot be found as if they were.
The alternative, publishing them under "sites we still maintain", would have been
a lie a customer could act on.

Raise these. Do not resolve them silently in either direction.

### "Verify in production"

Two bugs on this build existed **only** in production, and both were total
failures rather than degradations:

**Every form returned 403.** TLS terminated at the reverse proxy, so the Node
server saw plain HTTP and built `Astro.url` as `http://`. Browsers post forms
with `Origin: https://`. Astro's `checkOrigin` compared the two, found a
mismatch, and rejected every submission — lead capture, checkout, all of it. The
fix is `security.allowedDomains` in `astro.config.mjs`, which makes the
`X-Forwarded-Proto` header trusted. The dev server cannot reproduce this because
nothing sits in front of it.

**The build could not reach the CMS.** The public hostname was proxied through
Cloudflare, and the server could not reach its own domain back through the CDN —
while `npm ci` downloaded from the same network without complaint. Internal
service-to-service traffic should not leave the box; point the build at a
direct hostname.

**Rate limiting did nothing.** Both public endpoints had a per-IP limiter. Behind
Cloudflare, neither ever fired: Cloudflare answers from many edge addresses and
rotates between them, so `X-Forwarded-For`'s first entry — and Astro's
`clientAddress` with it — was a different edge IP on nearly every request. Every
bucket held one hit. Key on `CF-Connecting-IP`, which Cloudflare rewrites on
every proxied request.

That one is worth generalising: **a limiter that fails open is
indistinguishable from a working one until you try to trip it.** Test the limit,
not the happy path. Testing both sides of the CDN is what isolated it — through
Cloudflare twelve attempts all passed; straight to the origin the eleventh
returned 429, same container, same code.

The general lesson: anything involving proxies, protocol, or DNS is invisible
until it is deployed. Budget for a deploy-then-debug cycle instead of treating
the first deploy as a formality.

```bash
# Prove a limiter actually limits, on both paths
for i in $(seq 1 13); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST https://«site»/api/«endpoint» \
       -H 'Content-Type: application/json' -H 'Origin: https://«site»' -d '{}'
done; echo
# then again with --resolve «site»:443:«origin-ip» to bypass the CDN.
# Different results between the two means your client key is the CDN's, not the
# visitor's.
```

```bash
# The check that finds the origin bug in one command
curl -s -X POST https://«site»/api/«form-endpoint» \
     -H 'Origin: https://«site»' -H 'Accept: application/json' -d ''
# "Cross-site POST form submissions are forbidden" => allowedDomains is unset
```

### "Deploy order, and let it settle"

The Astro site is prerendered, so its build queries WordPress. That fixes the
order: **WordPress must be up, bootstrapped and reachable before the front end
will build at all.** With `WP_FAIL_ON_ERROR=1` it fails loudly rather than
shipping an empty site, which is what you want.

One trap on top of that: if the CMS seeds content in the background on first
boot, a front-end build triggered immediately after will race it and bake in
half-seeded content. It looks exactly like a caching bug and it is not. Poll the
CMS until the content count is what you expect, then build.

### On the boilerplate's own sharp edges

Two worth knowing before you start, both fixed in this repo:

- **A named volume over the webroot silently swallows image updates.** Docker
  seeds a named volume from the image only when the volume is first created.
  Anything `COPY`d into that path stops updating after the first deploy — and if
  that path holds the mu-plugins, deploys silently stop delivering the content
  model. Stage app files outside the volume and sync them in on boot.
- **The production image needs a way to configure itself.** Coolify has no exec
  API, so if the image has no wp-cli and no bootstrap, a fresh deploy leaves
  WordPress sitting on `install.php` with no GraphQL — and the front-end build
  fails with no obvious cause. Make the container install core, plugins and seed
  content itself, idempotently, on boot.

### What CI earns you here

Three real bugs on this build were caught by CI rather than by review:

- `$97` inside a double-quoted bash string, read as the positional `$9` followed
  by a literal `7` — caught by shellcheck
- a `wp_installing()` guard added to a mu-plugin without a matching stub in the
  test harness — caught by the schema-contract test
- query and component regressions — caught by building against the mock CMS

Worth wiring on day one, not at the end: shellcheck, `php -l` over the plugins,
the schema contract, and a full build against the mock server.
