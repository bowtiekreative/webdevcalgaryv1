#!/usr/bin/env bash
#
# Content seeding, shared by the local bootstrap and the production one.
#
#   scripts/wp-bootstrap.sh          — runs wp-cli through docker compose
#   wordpress/bin/bootstrap-production.sh — runs wp-cli inside the container
#
# Sourced, not executed: the caller defines `wp` and `info` first, because how
# you reach wp-cli is the only thing that differs between the two. Keeping the
# content itself in one file is the point — local and production drifting apart
# is how you get a staging site that does not match production.
#
# Everything here is idempotent. Re-running never clobbers an editor's work.

info "Seeding content"
seed_post() {
  local post_type="$1" title="$2" slug="$3" content="$4" status="${5:-publish}"
  if [[ -z "$(wp post list --post_type="${post_type}" --name="${slug}" --field=ID --post_status=any 2>/dev/null)" ]]; then
    wp post create \
      --post_type="${post_type}" \
      --post_title="${title}" \
      --post_name="${slug}" \
      --post_content="${content}" \
      --post_status="${status}" >/dev/null
    echo "created ${post_type}: ${slug} (${status})"
  else
    echo "exists  ${post_type}: ${slug}"
  fi
}

# --- Pages ---------------------------------------------------------------
# The funnel's own routes (/, /checkout, /teardown, /thank-you) are files in
# web/src/pages and must NOT exist as WordPress pages — see RESERVED_SLUGS in
# web/src/lib/routes.ts. These are the ones the footer links to.
seed_post page "Terms" "terms" \
  "<p>Month to month. Cancel any time, no penalty. You own the site, the domain and the content — if you leave, it comes with you.</p><p><strong>This is placeholder copy. Have it reviewed before launch.</strong></p>"
seed_post page "Privacy" "privacy" \
  "<p>We collect what you send us through the forms on this site — your name, business, phone, email and whatever you tell us about the work — and we use it to build and maintain your website. We don't sell it.</p><p><strong>This is placeholder copy. Have it reviewed before launch.</strong></p>"
seed_post page "Refund policy" "refund-policy" \
  "<p>If your site is not live within the window quoted at checkout, the rush fee is refunded in full and you keep the site. Within the first 30 days you can cancel and keep the site and the domain anyway.</p><p><strong>This is placeholder copy. Have it reviewed before launch.</strong></p>"

# --- Testimonials --------------------------------------------------------
# Peer proof. Real quotes from real clients — this is what closes trades, so
# it ships published. See web/src/funnel.ts for the copies used before
# WordPress has any.
# Tier 1 — the six the landing page shows. Ordered by menu_order below, so
# the strongest is first. Selection rule from assets/testimonials.md: lead with
# the ones that prove responsiveness, longevity and follow-through, because the
# buyer's real fear is being abandoned after launch, not getting an ugly site.
seed_post app_testimonial "Anatoli Barbu" "anatoli-barbu" ""
seed_post app_testimonial "Tony Masone" "tony-masone" ""
seed_post app_testimonial "Anna Rounseville" "anna-rounseville" ""
seed_post app_testimonial "Ryan Verkley" "ryan-verkley" ""
seed_post app_testimonial "Fred Diblasio" "fred-diblasio" ""
seed_post app_testimonial "Jully Black" "jully-black" ""

# Tier 2 — rotate through ads, drip emails and secondary pages.
seed_post app_testimonial "Jason Fronco" "jason-fronco" ""
seed_post app_testimonial "Dylan Mahaney" "dylan-mahaney" ""
seed_post app_testimonial "Bronson Digital" "bronson-digital" ""
seed_post app_testimonial "Nazim Beltran" "nazim-beltran" ""
seed_post app_testimonial "Michael D Haines" "michael-haines" ""
seed_post app_testimonial "Luis Class" "luis-class" ""
seed_post app_testimonial "Gary Martin" "gary-martin" ""
seed_post app_testimonial "Dave Boddy" "dave-boddy" ""
seed_post app_testimonial "Ahmed Rammay" "ahmed-rammay" ""
seed_post app_testimonial "S. Rasheem" "s-rasheem" ""
seed_post app_testimonial "Paul E." "paul-e" ""
seed_post app_testimonial "Joshua Therrien" "joshua-therrien" ""
seed_post app_testimonial "Imran Mirza" "imran-mirza" ""
seed_post app_testimonial "Danyelle Redwine" "danyelle-redwine" ""

# --- Services ------------------------------------------------------------
seed_post app_service "Website build and hosting" "website-build" \
  "<p>Design, build, copy, photos, mobile, domain, SSL and launch. Included in every plan — what costs money is the rush.</p>"
seed_post app_service "Unlimited changes" "unlimited-changes" \
  "<p>Send any change and it's done, usually within 48 hours. New page, seasonal promo, updated photos, changed hours. No change fee, no hourly clock.</p>"
seed_post app_service "Google Business Profile" "google-business-profile" \
  "<p>Categories, services, photos, hours and posting — the map listing that decides who gets the call. Included in Growth, or \$97 one-time as a rescue.</p>"
seed_post app_service "Local and AI search" "local-search" \
  "<p>Built to be found for Calgary searches, and by the AI assistants people now ask for recommendations. Included in Growth.</p>"
seed_post app_service "Website Rescue" "website-rescue" \
  "<p>Keep the site you have. We fix the five things costing you the most — mobile, speed, contact form, calls-to-action, Google listing. One time, no subscription.</p>"
seed_post app_service "Brand Story Film" "brand-story-film" \
  "<p>Your competitors all have the same stock photos. You'd have a real film. Two hours of your time, one shoot day, and you own it forever. Quoted separately.</p>"

# --- Portfolio -----------------------------------------------------------
#
# IMPORTANT: these fourteen are the *fictional* brands from the design deck
# ("Design system and funnel review" — each a distinct fictional brand, used to
# show one layout per industry). They are seeded as DRAFTS on purpose.
#
# The landing page copy above them reads "Sites we built. Sites we still
# maintain. These are live right now." Publishing a fictional brand under that
# sentence is a false claim, so nothing here goes live until it is replaced
# with a real client — at which point publish it in wp-admin.
#
# The portfolio sections render nothing while these are drafts, and the landing
# page hides the whole block. That is the intended pre-launch state.
seed_project() {
  local slug="$1" client="$2" trade="$3" trade_slug="$4" year="$5" summary="$6"
  seed_post app_project "${client}" "${slug}" "<p>${summary}</p>" draft
  local id
  id="$(post_id app_project "${slug}")"
  [[ -z "${id}" ]] && return 0
  set_meta "${id}" app_project_client "${client}"
  set_meta "${id}" app_project_year "${year}"
  set_meta "${id}" app_project_role "Design, build, hosting and ongoing changes"
  set_meta "${id}" app_project_summary "${summary}"
  wp term create app_industry "${trade}" --slug="${trade_slug}" >/dev/null 2>&1 || true
  wp post term add "${id}" app_industry "${trade_slug}" >/dev/null 2>&1 || true
}

info "Seeding Meta Box field values"

# Meta Box stores most fields as a single meta row keyed by the field ID. A
# cloneable field (clone => true) is ONE row holding a serialized array, not
# repeated rows — hence set_meta_list using --format=json.
post_id() {
  wp post list --post_type="$1" --name="$2" --field=ID --post_status=any 2>/dev/null | tr -d '\r'
}

# Only fills empty fields, so re-running never clobbers an editor's work.
set_meta() {
  local id="$1" key="$2" value="$3"
  [[ -z "${id}" ]] && return 0
  if [[ -z "$(wp post meta get "${id}" "${key}" 2>/dev/null | tr -d '\r')" ]]; then
    wp post meta update "${id}" "${key}" "${value}" >/dev/null
  fi
}

set_meta_list() {
  local id="$1" key="$2" json="$3"
  [[ -z "${id}" ]] && return 0
  if [[ -z "$(wp post meta get "${id}" "${key}" 2>/dev/null | tr -d '\r')" ]]; then
    wp post meta update "${id}" "${key}" --format=json "${json}" >/dev/null
  fi
}

seed_project chinook-heating   "Chinook Heating & Air"      "HVAC"                "hvac"        2019 "Furnace, AC and heat pump work across Calgary — same-day repair, flat-rate pricing."
seed_project bow-river-plumbing "Bow River Plumbing Co."    "Plumbing"            "plumbing"    2020 "Emergency plumbing and drains, with an on-call number that gets answered."
seed_project amped-electric    "Amped Electric"             "Electrical"          "electrical"  2021 "Residential and light commercial electrical, permits pulled on every job."
seed_project foothills-roofing "Foothills Roofing"          "Roofing"             "roofing"     2018 "Hail claims, re-roofs and repairs — Calgary's most-claimed trade."
seed_project prairie-edge      "Prairie Edge Landscaping"   "Landscaping & snow"  "landscaping" 2022 "Landscaping through summer, snow contracts through winter. One site, two seasons."
seed_project caliber-concrete  "Caliber Concrete Works"     "Concrete"            "concrete"    2020 "Driveways, garage pads and walkways, with a gallery that does the selling."
seed_project northmount-renos  "Northmount Renovations"     "Renovation"          "renovation"  2019 "Basements, kitchens and whole-home renos, quoted before anything is opened up."
seed_project ridgeline-garage  "Ridgeline Garage Doors"     "Garage doors"        "garage-doors" 2021 "Door and opener replacement, with same-day emergency service."
seed_project kensington-dental "Kensington Dental Studio"   "Dental"              "dental"      2021 "A calm, fast site for a practice that hates dentist-office clichés."
seed_project silverbirch-spa   "Silverbirch Med Spa"        "Med spa"             "med-spa"     2022 "Treatments, pricing and online booking, without the stock photography."
seed_project whitfield-law     "Whitfield Law"              "Law"                 "law"         2018 "Practice areas and a contact form that actually reaches a lawyer."
seed_project crossfield-cpa    "Crossfield & Co. CPA"       "Accounting"          "accounting"  2020 "Services, deadlines and a client portal link — busiest four months of the year."
seed_project deerfoot-auto     "Deerfoot Auto Works"        "Auto repair"         "auto-repair" 2019 "Repairs, inspections and tire storage, with tap-to-call on every screen."
seed_project spruce-ember      "Spruce & Ember"             "Restaurant"          "restaurant"  2023 "Menu, hours and reservations — the three things people actually came for."

info "Seeding testimonial fields"
# order: menu_order, which is what the front end sorts by. Tier 1 gets 1-6 so
# the six strongest lead; tier 2 gets 20+ and only appears where all of them
# are listed.
seed_quote() {
  local slug="$1" order="$2" quote="$3" author="$4" company="$5"
  local id
  id="$(post_id app_testimonial "${slug}")"
  [[ -z "${id}" ]] && return 0
  wp post update "${id}" --menu_order="${order}" >/dev/null 2>&1 || true
  set_meta "${id}" app_testimonial_quote "${quote}"
  set_meta "${id}" app_testimonial_author "${author}"
  set_meta "${id}" app_testimonial_company "${company}"
  set_meta "${id}" app_testimonial_rating 5
}

seed_quote anatoli-barbu 1 \
  "Ryan and his team are absolutely amazing! They went above and beyond when creating my new website from scratch. They communicated often, made sure I was updated every step of the way and ensured that I was fully satisfied with every aspect of my website. They are well priced and were always responsive to my questions, ideas and changes." \
  "Anatoli Barbu" "Barbu Entertainment"
seed_quote tony-masone 2 \
  "I strongly recommend Ryan Perez and his team at Bow Tie Kreative. He has given my firm excellent service that was also on time and on budget. My profile has increased with the advertising and web work that Bow Tie Kreative has done for my firm. It has increased my business and given me new leads for additional work." \
  "Tony Masone" ""
seed_quote anna-rounseville 3 \
  "His work ethic is iron clad, and he researches the best tools to get things done even if it means coding something himself." \
  "Anna Rounseville" ""
seed_quote ryan-verkley 4 \
  "Bow Tie Kreative taught me how to modify and edit the site, as well as how to get the most out of its features. His methods of search engine optimization have already shown an increase in traffic to our site." \
  "Ryan Verkley" ""
seed_quote fred-diblasio 5 \
  "I was pleased to work with Bow Tie Kreative - they were professional, asked the right questions and delivered on time. I would recommend them to family and friends!" \
  "Fred Diblasio" ""
seed_quote jully-black 6 \
  "Your work is incredible! 450 guests and Canada's BEST in communications all LOVED what you did. Thank U" \
  "Jully Black" ""

seed_quote jason-fronco 20 \
  "Ryan Perez with Bow Tie Kreative is very knowledgeable in what they do and is a great valid asset for any design marketing agency." \
  "Jason Fronco" ""
seed_quote dylan-mahaney 21 \
  "Ryan was really efficient and provided a really great product. We were able to use the graphics and websites to promote shows as well as contests. He also provided us with video editing." \
  "Dylan Mahaney" ""
seed_quote bronson-digital 22 \
  "Ryan is an expert when it comes to website design, branding, and establishing your online presence." \
  "Owner" "Bronson Digital"
seed_quote nazim-beltran 23 \
  "Ryan gave the site a full review and pointed me in the direction to implement the changes needed to improve its overall SEO reach." \
  "Nazim Beltran" ""
seed_quote michael-haines 24 \
  "As a public speaker, with a need for a highly interactive website, these people are the best in the business." \
  "Michael D Haines" ""
seed_quote luis-class 25 \
  "Bow Tie Kreative handled our production professionally and in a timely manner!" \
  "Luis Class" ""
seed_quote gary-martin 26 \
  "Bow Tie Kreative is very innovative, always looking for new solutions and fresh ideas." \
  "Gary Martin" ""
seed_quote dave-boddy 27 \
  "Ryan has been a great asset to my company. I will always refer Ryan and his company." \
  "Dave Boddy" ""
seed_quote ahmed-rammay 28 \
  "Ryan was easy to work with and quick to respond. He makes it effortless and goes that extra mile." \
  "Ahmed Rammay" ""
seed_quote s-rasheem 29 \
  "I had a fantastic experience with Bow Tie Kreative. He showed me how to transform my website and boost my SEO ranking." \
  "S. Rasheem" ""
seed_quote paul-e 30 \
  "Ryan was just very good to work with, he explained everything to me and was very patient with me through this process." \
  "Paul E." ""
seed_quote joshua-therrien 31 \
  "He did great work and really did a great job designing them. Great eye for design." \
  "Joshua Therrien" ""
seed_quote imran-mirza 32 \
  "We wish to continue doing business with Bow Tie Kreative and also recommend others, not to look further for your brand development." \
  "Imran Mirza" ""
seed_quote danyelle-redwine 33 \
  "I am learning a lot from your shows - especially branding and marketing." \
  "Danyelle Redwine" ""

info "Seeding service fields"
set_service() {
  local slug="$1" tagline="$2" price="$3" bullets="$4"
  local id
  id="$(post_id app_service "${slug}")"
  [[ -z "${id}" ]] && return 0
  set_meta "${id}" app_service_tagline "${tagline}"
  [[ -n "${price}" ]] && set_meta "${id}" app_service_starting_price "${price}"
  set_meta_list "${id}" app_service_bullets "${bullets}"
}

set_service website-build "Live in 24 hours, or the rush fee comes back." "Included" \
  '["Design and build","Copy, photos, mobile","Domain, SSL and launch","Hosting, backups, security"]'
set_service unlimited-changes "Send it, it gets done. Usually within 48 hours." "Included" \
  '["No change fee","No hourly clock","One request at a time","Forever, not for a year"]'
set_service google-business-profile "The listing that decides who gets the call." "\$97 one-time" \
  '["Categories and services","Photos and hours","Regular posting","Review requests"]'
set_service local-search "Found on Google, and by the AI people ask now." "Growth plan" \
  '["Calgary local SEO","AI search visibility","Monthly report, plain English"]'
set_service website-rescue "Keep your site. Fix what is costing you." "\$297 one-time" \
  '["Mobile","Speed","Contact form","Calls-to-action","Google listing"]'
set_service brand-story-film "A real film, not stock photos." "From \$2,500" \
  '["One shoot day","Two hours of your time","You own it forever"]'

# No WordPress front page. "/" is web/src/pages/index.astro — the funnel — and
# a page_on_front here would only create a second, unreachable home page for an
# editor to wonder about.
wp option update show_on_front posts
