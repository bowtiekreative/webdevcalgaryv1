# Design Brief — hand this to your designer

**Project:** websitecalgary.com landing page + Meta ad creative
**Client:** Bow Tie Kreative, Calgary AB
**Working reference:** `assets/index.html` — a functioning page with the intended
structure, palette and type already applied. Treat it as the spec, not a
suggestion, unless you have a specific reason to depart from it.

---

## Who this is for

A Calgary owner-operator, 38–55, running a trades or home-services business.
Reads on a phone, often in a truck, often between jobs. Has been burned by a web
designer before. Skeptical of anything that looks like marketing.

**Design to that person, not to a design award.** If it looks like a Silicon
Valley SaaS site, it's wrong. If it looks like a $50/hr template, it's also
wrong. It should look like a serious tradesperson's tool: plain, confident,
well-made, no decoration.

---

## Palette

| Token | Hex | Use |
|---|---|---|
| Ink | `#14161A` | Text, borders, dark sections |
| Ink 2 | `#4A4F58` | Body copy, secondary text |
| Paper | `#FFFFFF` | Main background |
| Concrete | `#ECEAE4` | Alternating section background |
| Rust | `#A83A1C` | Primary accent — CTAs, eyebrows, highlights |
| Hi-vis | `#F2B233` | Signature accent — the clock, prices, key numbers |
| Chinook | `#1E3A5C` | Guarantee section only |
| Line | `#D6D2C8` | Rules and dividers |

**Reasoning:** these come from the audience's actual visual world — truck primer
and brick (rust), safety vest (hi-vis), salt-stained concrete, the chinook arch.

**Do not use:** blue-teal corporate gradients (every Calgary agency uses them),
purple, glassmorphism, soft drop shadows, illustrated blob backgrounds, rounded
"friendly" corners. Border radius is **zero** throughout. That's deliberate.

---

## Typography

- **Display:** Archivo, weight 800, letter-spacing `-0.025em`. Big, tight,
  industrial. Headlines should feel heavy.
- **Body:** Inter, 400/500/600, 17px base.
- **Utility / data:** JetBrains Mono — used for the clock, prices, work-order
  serial numbers, timestamps, eyebrow labels.

The mono face is doing real work: it encodes the "work order / dispatch" idea
that the whole page is built on. Don't swap it for another sans.

---

## The signature element

**A live 24-hour countdown clock in the hero.** Hi-vis amber, mono, oversized,
sitting in a black dispatch panel. It shows the actual go-live time, calculated
from the visitor's current time.

This is the one thing the page should be remembered by. It turns the core promise
from a claim into a moving object on the screen. Everything else on the page
should stay quiet so this lands.

**Supporting motif:** the pricing block is styled as a **work order** — ruled
rows, mono serial numbers (WC-RUSH, WC-100, WC-200), items listed as "Included"
with a single priced line. Trades people recognize this form instantly.

---

## Layout rules

- Max width 1080px
- Section padding 72px desktop / 52px mobile
- Hard 2px borders, no shadows except the offset "printed" shadow on primary
  buttons (4px 4px 0, solid)
- Buttons translate -2px on hover with the shadow growing to 6px — a physical,
  pressed feel
- Sticky bottom bar on mobile: **Call now** | **Start →**. Non-negotiable

---

## Restraint

One bold element (the clock). Everything else disciplined. If you're deciding
whether to add a flourish, don't.

**No stock photography of smiling people in hardhats.** Calgarians identify
generic stock imagery immediately and it destroys trust faster than a bad layout.
Real client sites, real screenshots, real photos of Ryan, or nothing.

---

## Quality floor

- Fully responsive down to 320px
- Visible keyboard focus states
- `prefers-reduced-motion` respected — the clock still displays, it just doesn't
  need to animate anything else
- Lazy-load video embeds; they must not block first paint
- Test on a real phone on LTE, not a browser resize

---

## Proof block hierarchy — important

The page has two kinds of proof and they are **not** interchangeable:

1. **Peer proof** — 20 text testimonials from business owners. *This is what
   closes trades.* Give it the larger, more prominent treatment.
2. **Authority proof** — video endorsements from Norman Seeff, Renée Taylor and
   Jully Black. *This reassures but does not close.* Keep it visually smaller
   and place it so it never stands alone.

If authority proof dominates, a contractor reads "expensive, not for me" and
leaves. Peer proof first, always.

---

## Ad creative

Full briefs in `04-ad-concepts.md`. Formats needed:

- 4:5 static (primary feed)
- 9:16 Reels/Stories
- 1:1 (secondary placements)
- 6-card carousel

Same palette and type as the page. Same principle: **deliberately unpolished
beats polished** for the video angles. The message is "I'm a real person who
answers the phone," and high production value works against that.
