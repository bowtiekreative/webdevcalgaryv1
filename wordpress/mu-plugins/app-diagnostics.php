<?php
/**
 * Plugin Name: App — Diagnostics
 * Description: Reports how content maps from database to schema, for the dashboard health check.
 * Version:     1.0.0
 *
 * Answers "is everything actually wired up?" from the WordPress side: which
 * post types exist, how many rows each has, which Meta Box fields are
 * registered, and whether each one reached GraphQL and REST. The Astro health
 * page pairs this with its own collections and route table.
 *
 * Reports structure and counts only. Setting *values* are never included —
 * booleans say whether a key is present, nothing more — so a leaked response
 * cannot hand over credentials.
 *
 * Endpoint (Astro server only, shared-secret protected):
 *   GET /wp-json/app/v1/diagnostics
 *
 * @package App
 */

declare( strict_types = 1 );

namespace App\Diagnostics;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Post types this project owns, plus the core ones the front end reads.
 *
 * @return array<int,string>
 */
function tracked_post_types(): array {
	return [ 'post', 'page', 'app_project', 'app_service', 'app_testimonial' ];
}

/**
 * Row counts per status for a post type.
 *
 * @param string $post_type Post type key.
 * @return array<string,int>
 */
function counts_for( string $post_type ): array {
	$counts = wp_count_posts( $post_type );

	if ( ! is_object( $counts ) ) {
		return [ 'publish' => 0, 'draft' => 0, 'total' => 0 ];
	}

	$publish = (int) ( $counts->publish ?? 0 );
	$draft   = (int) ( $counts->draft ?? 0 );
	$total   = 0;

	foreach ( get_object_vars( $counts ) as $count ) {
		$total += (int) $count;
	}

	return [ 'publish' => $publish, 'draft' => $draft, 'total' => $total ];
}

/**
 * Meta keys registered for REST on a post type.
 *
 * @param string $post_type Post type key.
 * @return array<int,string>
 */
function rest_meta_keys( string $post_type ): array {
	$registered = get_registered_meta_keys( 'post', $post_type );

	if ( ! is_array( $registered ) ) {
		return [];
	}

	$out = [];

	foreach ( $registered as $key => $config ) {
		if ( ! empty( $config['show_in_rest'] ) ) {
			$out[] = (string) $key;
		}
	}

	return $out;
}

/**
 * Describe every Meta Box group and whether each field reached REST.
 *
 * @return array<int,array>
 */
function field_groups(): array {
	if ( ! function_exists( 'rwmb_meta' ) ) {
		return [];
	}

	$groups = apply_filters( 'rwmb_meta_boxes', [] );

	if ( ! is_array( $groups ) ) {
		return [];
	}

	$out = [];

	foreach ( $groups as $group ) {
		if ( ! is_array( $group ) || empty( $group['fields'] ) ) {
			continue;
		}

		$post_types = $group['post_types'] ?? 'post';
		$post_types = is_array( $post_types ) ? $post_types : [ $post_types ];

		// REST registration is per post type; the first is representative
		// because register_field() runs identically for each.
		$rest_keys = rest_meta_keys( (string) ( $post_types[0] ?? 'post' ) );

		$fields = [];

		foreach ( $group['fields'] as $field ) {
			if ( ! is_array( $field ) || empty( $field['id'] ) ) {
				continue;
			}

			$id     = (string) $field['id'];
			$type   = (string) ( $field['type'] ?? '' );
			$in_gql = ! ( isset( $field['graphql'] ) && false === $field['graphql'] )
				&& ! in_array( $type, [ 'heading', 'custom_html', 'divider', 'button', 'tab', 'nonce' ], true );

			$fields[] = [
				'id'       => $id,
				'type'     => $type,
				'clone'    => ! empty( $field['clone'] ),
				'inRest'   => in_array( $id, $rest_keys, true ),
				'inGraphl' => $in_gql,
			];
		}

		$out[] = [
			'id'          => (string) ( $group['id'] ?? '' ),
			'title'       => (string) ( $group['title'] ?? '' ),
			'graphqlName' => (string) ( $group['graphql_name'] ?? '' ),
			'postTypes'   => array_values( array_map( 'strval', $post_types ) ),
			'fields'      => $fields,
		];
	}

	return $out;
}

/**
 * Core tables and their row counts.
 *
 * @return array<int,array{name:string,rows:int}>
 */
function tables(): array {
	global $wpdb;

	$targets = [
		$wpdb->posts,
		$wpdb->postmeta,
		$wpdb->users,
		$wpdb->usermeta,
		$wpdb->terms,
		$wpdb->term_taxonomy,
		$wpdb->options,
	];

	$out = [];

	foreach ( $targets as $table ) {
		// Table names come from $wpdb, never from input.
		$rows = $wpdb->get_var( "SELECT COUNT(*) FROM `{$table}`" ); // phpcs:ignore WordPress.DB

		$out[] = [
			'name' => (string) $table,
			'rows' => null === $rows ? -1 : (int) $rows,
		];
	}

	return $out;
}

/**
 * Build the report.
 *
 * @return array
 */
function report(): array {
	global $wpdb;

	$post_types = [];

	foreach ( tracked_post_types() as $key ) {
		$object = get_post_type_object( $key );

		if ( null === $object ) {
			$post_types[] = [ 'key' => $key, 'registered' => false ];
			continue;
		}

		$post_types[] = [
			'key'            => $key,
			'registered'     => true,
			'label'          => (string) ( $object->labels->name ?? $key ),
			'public'         => (bool) $object->public,
			'showInRest'     => (bool) ( $object->show_in_rest ?? false ),
			'restBase'       => (string) ( $object->rest_base ?: $key ),
			'showInGraphql'  => (bool) ( $object->show_in_graphql ?? false ),
			'graphqlSingle'  => (string) ( $object->graphql_single_name ?? '' ),
			'graphqlPlural'  => (string) ( $object->graphql_plural_name ?? '' ),
			'restMetaKeys'   => rest_meta_keys( $key ),
			'counts'         => counts_for( $key ),
		];
	}

	$taxonomies = [];

	foreach ( [ 'app_capability', 'app_industry', 'category', 'post_tag' ] as $key ) {
		$object = get_taxonomy( $key );

		$taxonomies[] = [
			'key'        => $key,
			'registered' => false !== $object,
			'terms'      => false !== $object ? (int) wp_count_terms( [ 'taxonomy' => $key, 'hide_empty' => false ] ) : 0,
			'inGraphql'  => false !== $object && ! empty( $object->show_in_graphql ),
		];
	}

	$settings = function_exists( '\\App\\Settings\\get' ) ? \App\Settings\all() : [];

	// Booleans only — never the values.
	$key_status = [];

	foreach (
		[
			'stripe_secret_key',
			'stripe_webhook_secret',
			'stripe_price_starter',
			'stripe_price_studio',
			'paypal_client_id',
			'paypal_client_secret',
			'paypal_webhook_id',
			'paypal_plan_starter',
			'paypal_plan_studio',
			'emailit_api_key',
			'emailit_from',
		] as $key
	) {
		$key_status[ $key ] = '' !== (string) ( $settings[ $key ] ?? '' );
	}

	return [
		'wordpress'  => [
			'version'     => get_bloginfo( 'version' ),
			'php'         => PHP_VERSION,
			'environment' => function_exists( 'wp_get_environment_type' ) ? wp_get_environment_type() : 'unknown',
			'siteUrl'     => home_url(),
			'tablePrefix' => $wpdb->prefix,
			'permalinks'  => (string) get_option( 'permalink_structure' ),
		],
		'plugins'    => [
			'wpgraphql' => function_exists( 'register_graphql_field' ),
			'metabox'   => function_exists( 'rwmb_meta' ),
		],
		'database'   => [
			'connected' => ( null !== $wpdb->get_var( 'SELECT 1' ) ),
			'tables'    => tables(),
		],
		'postTypes'  => $post_types,
		'taxonomies' => $taxonomies,
		'fieldGroups' => field_groups(),
		'muPlugins'  => array_values(
			array_map(
				'basename',
				(array) glob( WPMU_PLUGIN_DIR . '/*.php' )
			)
		),
		'apiKeys'    => $key_status,
		'sharedSecret' => [
			// Whether each source has one, never which.
			'constant' => defined( 'APP_SHARED_SECRET' ) && '' !== (string) APP_SHARED_SECRET,
			'stored'   => '' !== (string) get_option( 'app_api_secret', '' ),
		],
		'siteMode'   => function_exists( '\\App\\Settings\\get' ) ? \App\Settings\get( 'site_mode', 'live' ) : 'live',
	];
}

/**
 * Register the route.
 */
function register_routes(): void {
	register_rest_route(
		\App\Auth\NAMESPACE_V1,
		'/diagnostics',
		[
			'methods'             => 'GET',
			'permission_callback' => '\\App\\Auth\\require_shared_secret',
			'callback'            => static function () {
				return new \WP_REST_Response( report(), 200 );
			},
		]
	);
}
add_action( 'rest_api_init', __NAMESPACE__ . '\\register_routes' );
