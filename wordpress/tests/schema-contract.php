<?php
/**
 * Schema contract check for the Meta Box → WPGraphQL bridge.
 *
 * The bridge derives GraphQL names from Meta Box field IDs (stripping each
 * group's shared prefix), so the names the Astro queries ask for are implied
 * rather than written down anywhere. This script loads the real mu-plugins
 * against a thin WordPress stub, records what the bridge would register, and
 * asserts it matches what web/src/lib/wp/queries.ts expects.
 *
 * Run it inside the WordPress container (no WordPress bootstrap needed):
 *
 *   docker compose exec wordpress php /var/www/html/btk-tests/schema-contract.php
 *
 * or with any PHP 8.1+ binary on the host:
 *
 *   php wordpress/tests/schema-contract.php
 *
 * Exits non-zero on a mismatch, so it works as a CI gate.
 *
 * @package BTK
 */

declare( strict_types = 1 );

define( 'ABSPATH', __DIR__ );

/* -------------------------------------------------------------------------
 * Minimal WordPress / Meta Box / WPGraphQL stubs
 * ---------------------------------------------------------------------- */

$GLOBALS['stub_filters']    = [];
$GLOBALS['stub_post_types'] = [];
$GLOBALS['stub_schema']     = [];
$GLOBALS['stub_types']      = [];

function add_filter( string $hook, $callback, int $priority = 10, int $args = 1 ): void {
	$GLOBALS['stub_filters'][ $hook ][] = $callback;
}

function add_action( string $hook, $callback, int $priority = 10, int $args = 1 ): void {
	add_filter( $hook, $callback, $priority, $args );
}

function apply_filters( string $hook, $value, ...$rest ) {
	foreach ( $GLOBALS['stub_filters'][ $hook ] ?? [] as $callback ) {
		$value = $callback( $value, ...$rest );
	}

	return $value;
}

function do_action( string $hook, ...$args ): void {
	foreach ( $GLOBALS['stub_filters'][ $hook ] ?? [] as $callback ) {
		$callback( ...$args );
	}
}

function __( string $text, string $domain = '' ): string {
	return $text;
}

function register_post_type( string $key, array $args = [] ) {
	$GLOBALS['stub_post_types'][ $key ] = $args;

	return (object) $args;
}

function register_taxonomy( string $key, $object_types, array $args = [] ): void {
}

function get_post_type_object( string $key ) {
	if ( isset( $GLOBALS['stub_post_types'][ $key ] ) ) {
		return (object) $GLOBALS['stub_post_types'][ $key ];
	}

	// Core types the bridge is expected to fall back on.
	if ( in_array( $key, [ 'post', 'page', 'attachment' ], true ) ) {
		return (object) [];
	}

	return null;
}

function get_option( string $name, $default = false ) {
	return $default;
}

function update_option( string $name, $value ): bool {
	return true;
}

function flush_rewrite_rules( bool $hard = true ): void {
}

// Presence of these two is how the bridge decides whether to run at all.
function rwmb_meta( string $id, $args = [], $object_id = null ) {
	return null;
}

function register_graphql_field( string $type, string $field, array $config ): void {
	$GLOBALS['stub_schema'][ $type ][ $field ] = $config['type'];
}

function register_graphql_object_type( string $name, array $config ): void {
	$GLOBALS['stub_types'][ $name ] = $config['fields'] ?? [];
}

/* -------------------------------------------------------------------------
 * Load the real plugins
 * ---------------------------------------------------------------------- */

/*
 * Works both from a checkout (../mu-plugins) and from inside the WordPress
 * container, where this directory is mounted at /var/www/html/btk-tests and the
 * plugins live under wp-content/.
 */
$mu = null;

foreach ( [ __DIR__ . '/../mu-plugins', '/var/www/html/wp-content/mu-plugins' ] as $candidate ) {
	if ( is_file( $candidate . '/btk-graphql-metabox.php' ) ) {
		$mu = $candidate;
		break;
	}
}

if ( null === $mu ) {
	fwrite( STDERR, "Could not locate the mu-plugins directory.\n" );
	exit( 2 );
}

require $mu . '/btk-post-types.php';
require $mu . '/btk-fields.php';
require $mu . '/btk-graphql-metabox.php';

do_action( 'init' );
do_action( 'graphql_register_types' );

/* -------------------------------------------------------------------------
 * Expectations — these mirror web/src/lib/wp/queries.ts
 * ---------------------------------------------------------------------- */

/** Group field expected on each GraphQL type, and the object type it returns. */
$expected_groups = [
	'Project'     => [ 'projectDetails' => 'BtkProjectDetails', 'seo' => 'BtkSeo' ],
	'Service'     => [ 'serviceDetails' => 'BtkServiceDetails', 'seo' => 'BtkSeo' ],
	'Testimonial' => [ 'testimonialDetails' => 'BtkTestimonialDetails' ],
	'Page'        => [ 'hero' => 'BtkHero', 'seo' => 'BtkSeo' ],
	'Post'        => [ 'seo' => 'BtkSeo' ],
];

/** Leaf fields expected on each object type, with their GraphQL type. */
$expected_fields = [
	'BtkProjectDetails' => [
		'client'       => 'String',
		'year'         => 'Int',
		'role'         => 'String',
		'summary'      => 'String',
		'deliverables' => [ 'list_of' => 'String' ],
		'url'          => 'String',
		'hero'         => 'BtkMediaItem',
		'gallery'      => [ 'list_of' => 'BtkMediaItem' ],
		'featured'     => 'Boolean',
	],
	'BtkServiceDetails' => [
		'tagline'       => 'String',
		'icon'          => 'String',
		'bullets'       => [ 'list_of' => 'String' ],
		'startingPrice' => 'String',
	],
	'BtkTestimonialDetails' => [
		'quote'   => 'String',
		'author'  => 'String',
		'role'    => 'String',
		'company' => 'String',
		'photo'   => 'BtkMediaItem',
		'rating'  => 'String',
		'project' => 'BtkPostRef',
	],
	'BtkHero' => [
		'eyebrow'    => 'String',
		'heading'    => 'String',
		'subheading' => 'String',
		'image'      => 'BtkMediaItem',
		'ctaLabel'   => 'String',
		'ctaUrl'     => 'String',
	],
	'BtkSeo' => [
		'title'       => 'String',
		'description' => 'String',
		'image'       => 'BtkMediaItem',
		'noindex'     => 'Boolean',
	],
];

/* -------------------------------------------------------------------------
 * Compare
 * ---------------------------------------------------------------------- */

$failures = [];

foreach ( $expected_groups as $graphql_type => $groups ) {
	foreach ( $groups as $field => $object_type ) {
		$actual = $GLOBALS['stub_schema'][ $graphql_type ][ $field ] ?? null;

		if ( null === $actual ) {
			$present    = array_keys( $GLOBALS['stub_schema'][ $graphql_type ] ?? [] );
			$failures[] = sprintf(
				'%s.%s is missing (type has: %s)',
				$graphql_type,
				$field,
				$present ? implode( ', ', $present ) : 'nothing'
			);
			continue;
		}

		if ( $actual !== $object_type ) {
			$failures[] = sprintf( '%s.%s returns %s, expected %s', $graphql_type, $field, var_export( $actual, true ), $object_type );
		}
	}
}

foreach ( $expected_fields as $object_type => $fields ) {
	if ( ! isset( $GLOBALS['stub_types'][ $object_type ] ) ) {
		$failures[] = sprintf( 'object type %s was never registered', $object_type );
		continue;
	}

	$actual_fields = $GLOBALS['stub_types'][ $object_type ];

	foreach ( $fields as $name => $type ) {
		if ( ! isset( $actual_fields[ $name ] ) ) {
			$failures[] = sprintf(
				'%s.%s is missing (type has: %s)',
				$object_type,
				$name,
				implode( ', ', array_keys( $actual_fields ) )
			);
			continue;
		}

		$actual = $actual_fields[ $name ]['type'];

		if ( $actual !== $type ) {
			$failures[] = sprintf(
				'%s.%s is %s, expected %s',
				$object_type,
				$name,
				str_replace( [ "\n", ' ' ], '', var_export( $actual, true ) ),
				str_replace( [ "\n", ' ' ], '', var_export( $type, true ) )
			);
		}
	}

	// A field the front end does not know about is not an error, but it is
	// usually a sign the two sides have drifted.
	$extra = array_diff( array_keys( $actual_fields ), array_keys( $fields ) );

	if ( $extra ) {
		printf( "note: %s also exposes %s\n", $object_type, implode( ', ', $extra ) );
	}
}

/* -------------------------------------------------------------------------
 * Report
 * ---------------------------------------------------------------------- */

echo "\nRegistered schema:\n";

foreach ( $GLOBALS['stub_schema'] as $type => $fields ) {
	printf( "  %s\n", $type );

	foreach ( $fields as $field => $returns ) {
		printf( "    %s: %s\n", $field, is_array( $returns ) ? json_encode( $returns ) : $returns );
	}
}

if ( $failures ) {
	echo "\n" . count( $failures ) . " mismatch(es):\n";

	foreach ( $failures as $failure ) {
		echo '  ✗ ' . $failure . "\n";
	}

	exit( 1 );
}

echo "\n✓ Schema matches what the Astro queries expect.\n";
exit( 0 );
