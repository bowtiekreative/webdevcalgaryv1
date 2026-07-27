#!/usr/bin/env bash
#
# Bootstrap the production WordPress from inside its own container.
#
# Runs on every boot and is idempotent — the first boot installs core, plugins
# and content; every boot after that short-circuits on the guards. That is the
# point: a Coolify deploy is the whole setup procedure, with nothing to
# remember and no way for a rebuilt container to come up half-configured.
#
# Called by apache2-app-entrypoint, in the background, so a slow first run
# never delays Apache. Its output goes to the container log.

set -uo pipefail

WP_PATH=/var/www/html

info() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$1" >&2; }

# wp-cli runs as root here (the container's only user for this task) and
# against the webroot the official entrypoint just populated.
wp() { command wp --allow-root --path="${WP_PATH}" "$@"; }

# --- Preconditions --------------------------------------------------------

# wp-config.php is written by the base image's entrypoint from the
# WORDPRESS_DB_* variables. Without it there is nothing to talk to.
for _ in $(seq 1 60); do
	[[ -f "${WP_PATH}/wp-config.php" ]] && break
	sleep 2
done

if [[ ! -f "${WP_PATH}/wp-config.php" ]]; then
	warn "wp-config.php never appeared; skipping bootstrap."
	exit 0
fi

info "Waiting for the database"
# `wp db query` and not `wp db check`: check runs mysqlcheck, and the Debian
# client refuses MySQL 8.4's self-signed TLS certificate, so it fails even
# against a perfectly healthy database. A trivial SELECT proves the same thing
# and actually succeeds.
for _ in $(seq 1 60); do
	if wp db query 'SELECT 1' >/dev/null 2>&1; then
		break
	fi
	sleep 2
done

# --- Core -----------------------------------------------------------------

SITE_URL="${SERVICE_FQDN_WORDPRESS:-}"

if [[ -z "${SITE_URL}" ]]; then
	warn "SERVICE_FQDN_WORDPRESS is not set; cannot install core with the right URL."
	exit 0
fi

# Coolify hands this over as a bare hostname or with a scheme, depending on how
# the domain was set. Normalise, because wp-cli wants an absolute URL and a
# wrong one bakes bad links into every permalink.
[[ "${SITE_URL}" == http*://* ]] || SITE_URL="https://${SITE_URL}"

if wp core is-installed >/dev/null 2>&1; then
	info "WordPress core already installed"
else
	info "Installing WordPress core at ${SITE_URL}"

	admin_pass="${WP_ADMIN_PASSWORD:-}"

	if [[ -z "${admin_pass}" ]]; then
		warn "WP_ADMIN_PASSWORD is empty; refusing to install with a blank or guessable admin password."
		exit 0
	fi

	wp core install \
		--url="${SITE_URL}" \
		--title="${WP_SITE_TITLE:-WebDevCalgary}" \
		--admin_user="${WP_ADMIN_USER:-admin}" \
		--admin_password="${admin_pass}" \
		--admin_email="${WP_ADMIN_EMAIL:-websites@bowtiekreative.com}" \
		--skip-email || {
		warn "core install failed"
		exit 0
	}
fi

# --- Plugins --------------------------------------------------------------
#
# WPGraphQL is the API the Astro build reads; Meta Box supplies the custom
# fields that app-graphql-metabox.php bridges into that schema. Neither is
# optional — without them the front end builds an empty site.

info "Installing plugins (WPGraphQL + Meta Box)"
for plugin in wp-graphql meta-box; do
	if wp plugin is-active "${plugin}" >/dev/null 2>&1; then
		echo "active  ${plugin}"
	else
		wp plugin install "${plugin}" --activate || warn "could not install ${plugin}"
	fi
done

# --- Settings -------------------------------------------------------------

info "Configuring permalinks and defaults"
# WPGraphQL needs pretty permalinks for /graphql to resolve at all.
wp rewrite structure '/%postname%/' --hard
wp rewrite flush --hard
wp option update default_comment_status closed
wp option update default_ping_status closed

# --- Content --------------------------------------------------------------

# shellcheck source=./seed-content.sh
source "$(dirname "$0")/seed-content.sh"

info "Bootstrap complete"
