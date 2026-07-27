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
wp option update blogname "WebDevCalgary"
wp option update blogdescription "Websites live in 24 hours. Unlimited changes. Price locked for life."
wp option update timezone_string "America/Edmonton"

# Content lives in wordpress/bin/seed-content.sh so the local stack and the
# production container seed identically. It uses the `wp` and `info` defined
# above.
# shellcheck source=../wordpress/bin/seed-content.sh
source wordpress/bin/seed-content.sh


info "Done"
cat <<EOF

  WordPress admin : ${SITE_URL}/wp-admin  (${WP_ADMIN_USER} / ${WP_ADMIN_PASSWORD})
  GraphQL endpoint: ${SITE_URL}/graphql
  GraphiQL IDE    : ${SITE_URL}/wp-admin/admin.php?page=graphiql-ide

  The 14 portfolio entries are seeded as DRAFTS. They are the fictional brands
  from the design deck, and the copy above them on the landing page says these
  are real sites we still maintain. Replace each with a real client, then
  publish it. Until then the portfolio block does not render at all.

  Next:
    cd web
    cp .env.example .env      # already points at ${SITE_URL}/graphql
    npm install
    npm run dev

EOF
