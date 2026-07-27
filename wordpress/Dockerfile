# WordPress image with this project's must-use plugins baked in.
#
# The local stack bind-mounts wordpress/mu-plugins so edits are live. In
# production the plugins are copied into the image instead, so a deploy is
# atomic and the running container has no writable dependency on the repo.

FROM wordpress:6.8-php8.3-apache

# The entire content model: post types, fields, GraphQL bridge, REST fields,
# auth, billing, settings, diagnostics.
COPY mu-plugins/ /var/www/html/wp-content/mu-plugins/

# CLI helpers and the schema contract check, kept outside wp-content so
# WordPress never tries to load them as plugins.
COPY bin/   /var/www/html/app-bin/
COPY tests/ /var/www/html/app-tests/

RUN chown -R www-data:www-data /var/www/html/wp-content/mu-plugins

# WordPress serves on 80; give it a domain in Coolify and the proxy handles TLS.
EXPOSE 80
