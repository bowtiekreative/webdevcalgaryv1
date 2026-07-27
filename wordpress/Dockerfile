# WordPress image with this project's must-use plugins baked in, and enough
# wp-cli to configure itself on first boot.
#
# Nothing is COPYed into /var/www/html. That path is a named volume in
# production, and Docker only seeds a named volume from the image the first
# time the volume is created — so anything written there in the image would
# stop updating after the first deploy, silently. The mu-plugins *are* the
# content model, so that failure mode is "deploys stop doing anything".
#
# Everything is staged in /opt/app instead and synced into the webroot by
# apache2-app-entrypoint on every boot.

FROM wordpress:6.8-php8.3-apache

# rsync for the boot-time sync; curl/unzip are what wp-cli needs to fetch and
# unpack plugins from wordpress.org.
#
# default-mysql-client is not optional despite looking it: `wp db` shells out
# to the mysql binaries rather than going through PHP, so without it the
# bootstrap's readiness probe fails with "env: 'mysql': No such file or
# directory" and burns its full timeout before continuing. It also makes
# `wp db export` available, which is the backup story.
#
# Note the probe uses `wp db query`, not `wp db check` — mysqlcheck rejects
# MySQL 8.4's self-signed certificate and fails against a healthy database.
RUN set -eux; \
	apt-get update; \
	apt-get install -y --no-install-recommends \
		ca-certificates \
		curl \
		default-mysql-client \
		less \
		rsync \
		unzip \
	; \
	rm -rf /var/lib/apt/lists/*

# wp-cli, pinned. An unpinned phar means a new wp-cli release can change what
# rebuilding an old commit does.
ENV WP_CLI_VERSION=2.11.0
RUN set -eux; \
	curl -fsSL -o /usr/local/bin/wp \
		"https://github.com/wp-cli/wp-cli/releases/download/v${WP_CLI_VERSION}/wp-cli-${WP_CLI_VERSION}.phar"; \
	chmod +x /usr/local/bin/wp; \
	wp --allow-root --info >/dev/null

# The entire content model: post types, fields, GraphQL bridge, REST fields,
# auth, billing, orders, settings, diagnostics.
COPY mu-plugins/ /opt/app/mu-plugins/

# CLI helpers, the bootstrap, and the schema contract check.
COPY bin/   /opt/app/bin/
COPY tests/ /opt/app/tests/

RUN chmod +x /opt/app/bin/apache2-app-entrypoint /opt/app/bin/*.sh

# The base image's entrypoint only installs WordPress and writes wp-config.php
# when the command starts with "apache2" — hence the name. See the script.
RUN ln -s /opt/app/bin/apache2-app-entrypoint /usr/local/bin/apache2-app-entrypoint

# WordPress serves on 80; give it a domain in Coolify and the proxy handles TLS.
EXPOSE 80

CMD ["apache2-app-entrypoint"]
