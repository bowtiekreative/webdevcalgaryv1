#!/usr/bin/env bash
#
# One-time setup for the local headless WordPress stack.
#
#   ./scripts/wp-bootstrap.sh
#
# Idempotent: safe to re-run. Installs WordPress core, WPGraphQL and Meta Box,
# switches to pretty permalinks and seeds a little demo content so the Astro
# front end has something to render.

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a && source .env && set +a
fi

WORDPRESS_PORT="${WORDPRESS_PORT:-8080}"
WP_ADMIN_USER="${WP_ADMIN_USER:-admin}"
WP_ADMIN_PASSWORD="${WP_ADMIN_PASSWORD:-admin}"
WP_ADMIN_EMAIL="${WP_ADMIN_EMAIL:-admin@example.com}"
WP_SITE_TITLE="${WP_SITE_TITLE:-Your Studio}"
SITE_URL="http://localhost:${WORDPRESS_PORT}"

wp() { docker compose run --rm -T wpcli "$@"; }

info() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }

if ! docker compose version >/dev/null 2>&1; then
  echo "error: docker compose is required but was not found." >&2
  echo "Install Docker Desktop, or Docker Engine + the compose plugin." >&2
  exit 1
fi

info "Starting containers"
docker compose up -d db wordpress

info "Waiting for WordPress to answer on ${SITE_URL}"
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "${SITE_URL}/wp-admin/install.php"; then break; fi
  sleep 2
done

info "Installing WordPress core"
if wp core is-installed >/dev/null 2>&1; then
  echo "already installed — skipping"
else
  wp core install \
    --url="${SITE_URL}" \
    --title="${WP_SITE_TITLE}" \
    --admin_user="${WP_ADMIN_USER}" \
    --admin_password="${WP_ADMIN_PASSWORD}" \
    --admin_email="${WP_ADMIN_EMAIL}" \
    --skip-email
fi

info "Installing plugins (WPGraphQL + Meta Box)"
wp plugin install wp-graphql meta-box --activate

info "Configuring permalinks and discussion defaults"
# WPGraphQL requires pretty permalinks for the /graphql route to resolve.
wp rewrite structure '/%postname%/' --hard
wp rewrite flush --hard
wp option update default_comment_status closed
wp option update default_ping_status closed
wp option update blogdescription "Brand, web and creative studio"

info "Seeding demo content"
seed_post() {
  local post_type="$1" title="$2" slug="$3" content="$4"
  if [[ -z "$(wp post list --post_type="${post_type}" --name="${slug}" --field=ID --post_status=any 2>/dev/null)" ]]; then
    wp post create \
      --post_type="${post_type}" \
      --post_title="${title}" \
      --post_name="${slug}" \
      --post_content="${content}" \
      --post_status=publish >/dev/null
    echo "created ${post_type}: ${slug}"
  else
    echo "exists  ${post_type}: ${slug}"
  fi
}

seed_post page "Home" "home" "<p>We build brands that wear a bow tie.</p>"
seed_post page "About" "about" "<p>A small studio with big opinions about type.</p>"
seed_post page "Contact" "contact" "<p>Say hello: ryan@bowtiekreative.com</p>"

seed_post app_project "Northside Coffee Rebrand" "northside-coffee" \
  "<p>A full identity refresh for a neighbourhood roaster.</p>"
seed_post app_project "Harbor Dental Website" "harbor-dental" \
  "<p>A calm, fast site for a practice that hates dentist-office clichés.</p>"

seed_post app_service "Brand Identity" "brand-identity" \
  "<p>Logo systems, type, colour and the rules that hold them together.</p>"
seed_post app_service "Web Design & Build" "web-design-build" \
  "<p>Design and development on a modern, fast stack.</p>"

seed_post app_testimonial "Dana at Northside" "dana-northside" \
  "<p>They understood the brief better than we did.</p>"

seed_post post "Why we went headless" "why-headless" \
  "<p>WordPress for editing, Astro for delivery.</p>"

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

northside="$(post_id app_project northside-coffee)"
set_meta "${northside}" app_project_client "Northside Coffee"
set_meta "${northside}" app_project_year 2026
set_meta "${northside}" app_project_role "Brand identity, packaging, art direction"
set_meta "${northside}" app_project_summary "One system, six touchpoints, zero committee meetings."
set_meta "${northside}" app_project_featured 1
set_meta_list "${northside}" app_project_deliverables '["Logo system","Packaging","Brand guidelines"]'

harbor="$(post_id app_project harbor-dental)"
set_meta "${harbor}" app_project_client "Harbor Dental"
set_meta "${harbor}" app_project_year 2025
set_meta "${harbor}" app_project_summary "A calm, fast site for a practice that hates dentist-office clichés."
set_meta "${harbor}" app_project_featured 1

brand="$(post_id app_service brand-identity)"
set_meta "${brand}" app_service_tagline "A system, not just a logo."
set_meta "${brand}" app_service_icon brand
set_meta "${brand}" app_service_starting_price "from \$6,500"
set_meta_list "${brand}" app_service_bullets '["Discovery workshop","Logo system","Type and colour","Guidelines"]'

web_service="$(post_id app_service web-design-build)"
set_meta "${web_service}" app_service_tagline "Fast sites, built to stay fast."
set_meta "${web_service}" app_service_icon web
set_meta "${web_service}" app_service_starting_price "from \$9,000"
set_meta_list "${web_service}" app_service_bullets '["Design system","Build","CMS setup","Launch support"]'

quote="$(post_id app_testimonial dana-northside)"
set_meta "${quote}" app_testimonial_quote "They understood the brief better than we did."
set_meta "${quote}" app_testimonial_author "Dana Reyes"
set_meta "${quote}" app_testimonial_role "Owner"
set_meta "${quote}" app_testimonial_company "Northside Coffee"
set_meta "${quote}" app_testimonial_rating 5
set_meta "${quote}" app_testimonial_project "${northside}"

home_page="$(post_id page home)"
set_meta "${home_page}" app_hero_eyebrow "Independent studio"
set_meta "${home_page}" app_hero_heading "Brands that wear a bow tie."
set_meta "${home_page}" app_hero_subheading "Identity, websites and campaigns for people who sweat the details."
set_meta "${home_page}" app_hero_cta_label "See the work"
set_meta "${home_page}" app_hero_cta_url "/work"

info "Assigning capabilities"
wp term create app_capability "Brand Identity" --slug=brand-identity >/dev/null 2>&1 || true
wp term create app_capability "Web Design" --slug=web-design >/dev/null 2>&1 || true
[[ -n "${northside}" ]] && wp post term add "${northside}" app_capability brand-identity >/dev/null 2>&1 || true
[[ -n "${harbor}" ]] && wp post term add "${harbor}" app_capability web-design >/dev/null 2>&1 || true
[[ -n "${brand}" ]] && wp post term add "${brand}" app_capability brand-identity >/dev/null 2>&1 || true
[[ -n "${web_service}" ]] && wp post term add "${web_service}" app_capability web-design >/dev/null 2>&1 || true

# Use the Home page as the front page so the page tree matches the front end.
home_id="$(wp post list --post_type=page --name=home --field=ID)"
if [[ -n "${home_id}" ]]; then
  wp option update show_on_front page
  wp option update page_on_front "${home_id}"
fi

info "Done"
cat <<EOF

  WordPress admin : ${SITE_URL}/wp-admin  (${WP_ADMIN_USER} / ${WP_ADMIN_PASSWORD})
  GraphQL endpoint: ${SITE_URL}/graphql
  GraphiQL IDE    : ${SITE_URL}/wp-admin/admin.php?page=graphiql-ide

  Next:
    cd web
    cp .env.example .env      # already points at ${SITE_URL}/graphql
    npm install
    npm run dev

EOF
