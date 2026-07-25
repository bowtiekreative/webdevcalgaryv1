<?php
/**
 * Rewrite the project prefix across an existing WordPress database.
 *
 * Run through wp-cli so it uses WordPress's own database connection:
 *
 *   wp eval-file /var/www/html/app-bin/migrate-prefix.php <old> <new>
 *
 * ../../scripts/migrate-prefix.sh is the wrapper you normally call.
 *
 * Why PHP and not `wp db query`: the wordpress:cli image ships a MariaDB client
 * that cannot authenticate against MySQL 8's caching_sha2_password, so every
 * `wp db query` fails. $wpdb goes through PHP's mysqli and works fine.
 *
 * Only a *leading* prefix is rewritten, so a key that merely contains the old
 * prefix mid-string is left alone. Safe to re-run: each statement is scoped to
 * rows still carrying the old prefix.
 *
 * Note: no `declare(strict_types=1)` here on purpose — `wp eval-file` runs the
 * file through eval(), where a declare() is not the first statement and would be
 * a fatal error.
 *
 * @package App
 */

/** @var array $args Positional arguments from `wp eval-file`. */
$old = isset( $args[0] ) ? trim( (string) $args[0] ) : '';
$new = isset( $args[1] ) ? trim( (string) $args[1] ) : '';

if ( '' === $old || '' === $new ) {
	WP_CLI::error( 'usage: wp eval-file migrate-prefix.php <old-prefix> <new-prefix>' );
}

if ( ! preg_match( '/^[a-z][a-z0-9]*$/', $old ) || ! preg_match( '/^[a-z][a-z0-9]*$/', $new ) ) {
	WP_CLI::error( 'Prefixes must be lowercase alphanumeric, without the trailing underscore.' );
}

if ( $old === $new ) {
	WP_CLI::success( 'Prefixes are identical — nothing to do.' );

	return;
}

global $wpdb;

$old_like = $wpdb->esc_like( $old . '_' ) . '%';
$offset   = strlen( $old ) + 2; // SQL SUBSTRING is 1-indexed, +1 for the underscore.

/*
 * table => column. Order does not matter; each is independent.
 *
 * usermeta is included because subscription state is stored per user
 * (app_subscription_status and friends), and options because the mu-plugins
 * keep a rewrite-version flag there.
 */
$targets = [
	$wpdb->posts         => 'post_type',
	$wpdb->postmeta      => 'meta_key',
	$wpdb->term_taxonomy => 'taxonomy',
	$wpdb->usermeta      => 'meta_key',
	$wpdb->options       => 'option_name',
];

$total = 0;

foreach ( $targets as $table => $column ) {
	// Table and column names come from $wpdb, never from input, so they are
	// safe to interpolate; the values are prepared.
	$before = (int) $wpdb->get_var(
		$wpdb->prepare( "SELECT COUNT(*) FROM `{$table}` WHERE `{$column}` LIKE %s", $old_like )
	);

	if ( 0 === $before ) {
		WP_CLI::log( sprintf( '  %-22s no rows on the old prefix', $table ) );
		continue;
	}

	/*
	 * wp_options.option_name is UNIQUE, so renaming into a name that already
	 * exists fails the whole statement. That is the normal case rather than an
	 * exotic one: as soon as the renamed code has run once, it has written
	 * app_rewrite_version itself, and the old btk_rewrite_version is stale.
	 *
	 * The row written by the current code is the authoritative one, so drop the
	 * old-prefix duplicate before renaming the rest.
	 */
	if ( $table === $wpdb->options ) {
		$dropped = $wpdb->query(
			$wpdb->prepare(
				"DELETE old FROM `{$table}` AS old
				  JOIN `{$table}` AS current
				    ON current.`{$column}` = CONCAT( %s, SUBSTRING( old.`{$column}`, %d ) )
				 WHERE old.`{$column}` LIKE %s",
				$new . '_',
				$offset,
				$old_like
			)
		);

		if ( (int) $dropped > 0 ) {
			WP_CLI::log( sprintf( '  %-22s %d stale duplicate(s) dropped', $table, (int) $dropped ) );
		}
	}

	$updated = $wpdb->query(
		$wpdb->prepare(
			"UPDATE `{$table}`
			    SET `{$column}` = CONCAT( %s, SUBSTRING( `{$column}`, %d ) )
			  WHERE `{$column}` LIKE %s",
			$new . '_',
			$offset,
			$old_like
		)
	);

	if ( false === $updated ) {
		WP_CLI::error( sprintf( 'Failed updating %s.%s: %s', $table, $column, $wpdb->last_error ) );
	}

	$total += (int) $updated;
	WP_CLI::log( sprintf( '  %-22s %d row(s) rewritten', $table, (int) $updated ) );
}

// Term and post caches hold the old post_type/taxonomy strings.
wp_cache_flush();
flush_rewrite_rules( true );

WP_CLI::success( sprintf( '%s_ → %s_ : %d row(s) rewritten.', $old, $new, $total ) );
