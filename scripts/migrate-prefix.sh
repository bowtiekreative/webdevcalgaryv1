#!/usr/bin/env bash
#
# Rename the project prefix in an existing WordPress database.
#
#   ./scripts/migrate-prefix.sh btk app
#
# The mu-plugins derive post types, taxonomies and Meta Box field IDs from a
# prefix (`app_project`, `app_project_client`, …). Changing that prefix in code
# orphans existing rows, because WordPress looks these up by the literal
# post_type / meta_key strings. This rewrites them.
#
# The actual work is done by wordpress/bin/migrate-prefix.php, executed through
# wp-cli so it runs on WordPress's own database connection — the CLI image's
# MariaDB client cannot authenticate against MySQL 8, so `wp db query` is not an
# option here.

set -euo pipefail

cd "$(dirname "$0")/.."

OLD="${1:-}"
NEW="${2:-}"

if [[ -z "${OLD}" || -z "${NEW}" ]]; then
  cat >&2 <<EOF
usage: $0 <old-prefix> <new-prefix>

  e.g. $0 btk app

Prefixes are given without the trailing underscore. Change the prefix in the
code first (wordpress/mu-plugins/, web/src/lib/wp/), then run this.
EOF
  exit 2
fi

printf '\n\033[1;34m==>\033[0m Migrating %s_ → %s_\n' "${OLD}" "${NEW}"

docker compose run --rm -T wpcli eval-file /var/www/html/app-bin/migrate-prefix.php "${OLD}" "${NEW}"

cat <<EOF

  Rebuild the front end so the content layer refetches:
    cd web && rm -f node_modules/.astro/data-store.json && npm run build

EOF
