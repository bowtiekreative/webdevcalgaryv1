<?php
/**
 * Plugin Name: App — Custom Fields in REST
 * Description: Exposes Meta Box fields through the WordPress REST API so CRUD works.
 * Version:     1.0.0
 *
 * `show_in_rest => true` on a post type exposes core fields only. Meta Box
 * fields are plain post meta, and post meta is invisible to REST until it is
 * registered with register_post_meta(). Without this, `GET /wp/v2/projects`
 * returns a project with no client, no year and no gallery, and there is no way
 * to write them — which would make the CRUD documentation a lie.
 *
 * Field groups are read from the same `rwmb_meta_boxes` filter the GraphQL
 * bridge uses, so REST and GraphQL cannot drift apart.
 *
 * Reads follow the post's own visibility. Writes require `edit_post` on that
 * specific post, so a subscriber cannot PATCH someone else's project.
 *
 * @package App
 */

declare( strict_types = 1 );

namespace App\Rest\Fields;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Meta Box types whose value is one attachment ID per meta row.
 *
 * These are stored unserialised across multiple rows, so they register as
 * `single => false`.
 */
const MULTI_ATTACHMENT_FIELDS = [ 'image', 'image_advanced', 'image_upload', 'file_advanced', 'file_upload', 'video' ];

/** Types stored as a single attachment ID. */
const SINGLE_ATTACHMENT_FIELDS = [ 'single_image', 'file', 'image_select' ];

/** Types with nothing worth exposing. */
const SKIPPED_FIELDS = [ 'heading', 'custom_html', 'divider', 'button', 'tab', 'nonce' ];

/**
 * Register every Meta Box field as REST-visible post meta.
 */
function register(): void {
	if ( ! function_exists( 'rwmb_meta' ) ) {
		return;
	}

	$groups = apply_filters( 'rwmb_meta_boxes', [] );

	if ( ! is_array( $groups ) ) {
		return;
	}

	foreach ( $groups as $group ) {
		if ( ! is_array( $group ) || empty( $group['fields'] ) || ! is_array( $group['fields'] ) ) {
			continue;
		}

		// Only post-backed groups; settings pages and term meta are elsewhere.
		if ( isset( $group['settings_pages'] ) || isset( $group['taxonomies'] ) ) {
			continue;
		}

		$post_types = $group['post_types'] ?? 'post';
		$post_types = is_array( $post_types ) ? $post_types : [ $post_types ];

		foreach ( $post_types as $post_type ) {
			foreach ( $group['fields'] as $field ) {
				register_field( (string) $post_type, is_array( $field ) ? $field : [] );
			}
		}
	}
}
// Priority 20: after app-fields.php has registered its groups on `init`.
add_action( 'init', __NAMESPACE__ . '\\register', 20 );

/**
 * Register one field.
 *
 * @param string $post_type Post type key.
 * @param array  $field     Meta Box field config.
 */
function register_field( string $post_type, array $field ): void {
	$key  = (string) ( $field['id'] ?? '' );
	$type = (string) ( $field['type'] ?? '' );

	if ( '' === $key || '' === $type || in_array( $type, SKIPPED_FIELDS, true ) ) {
		return;
	}

	if ( isset( $field['rest'] ) && false === $field['rest'] ) {
		return;
	}

	// Groups are nested arrays whose shape depends on a paid extension; a
	// partial schema would be worse than leaving them to GraphQL.
	if ( 'group' === $type ) {
		return;
	}

	$is_clone    = ! empty( $field['clone'] );
	$is_multiple = ! empty( $field['multiple'] );

	if ( in_array( $type, MULTI_ATTACHMENT_FIELDS, true ) ) {
		// One attachment ID per row.
		register_post_meta(
			$post_type,
			$key,
			[
				'single'        => false,
				'type'          => 'integer',
				'description'   => description( $field ),
				'show_in_rest'  => true,
				'auth_callback' => auth_callback( $post_type ),
			]
		);

		return;
	}

	if ( $is_clone || $is_multiple ) {
		// A single row holding a serialised list.
		register_post_meta(
			$post_type,
			$key,
			[
				'single'        => true,
				'type'          => 'array',
				'description'   => description( $field ),
				'auth_callback' => auth_callback( $post_type ),
				'show_in_rest'  => [
					'schema' => [
						'type'  => 'array',
						'items' => [ 'type' => 'string' ],
					],
				],
			]
		);

		return;
	}

	register_post_meta(
		$post_type,
		$key,
		[
			'single'        => true,
			'type'          => scalar_type( $field ),
			'description'   => description( $field ),
			'show_in_rest'  => true,
			'auth_callback' => auth_callback( $post_type ),
		]
	);
}

/**
 * Map a Meta Box field type to a REST scalar type.
 *
 * @param array $field Field config.
 * @return string One of string|integer|number|boolean.
 */
function scalar_type( array $field ): string {
	$type = (string) ( $field['type'] ?? '' );

	if ( in_array( $type, SINGLE_ATTACHMENT_FIELDS, true ) ) {
		return 'integer';
	}

	if ( in_array( $type, [ 'checkbox', 'switch' ], true ) ) {
		return 'boolean';
	}

	if ( in_array( $type, [ 'number', 'slider', 'range' ], true ) ) {
		$step = $field['step'] ?? 1;

		return ( is_numeric( $step ) && floor( (float) $step ) === (float) $step ) ? 'integer' : 'number';
	}

	return 'string';
}

/**
 * Human description for the REST schema.
 *
 * @param array $field Field config.
 * @return string
 */
function description( array $field ): string {
	$label = (string) ( $field['name'] ?? $field['id'] ?? '' );
	$type  = (string) ( $field['type'] ?? '' );

	return trim( sprintf( '%s (Meta Box %s field)', $label, $type ) );
}

/**
 * Who may write this meta.
 *
 * register_post_meta's auth_callback receives the object ID, so the check is
 * per-post rather than a blanket capability.
 *
 * @param string $post_type Post type key.
 * @return callable
 */
function auth_callback( string $post_type ): callable {
	return static function ( $allowed, $meta_key, $object_id ) use ( $post_type ) {
		unset( $allowed, $meta_key, $post_type );

		return current_user_can( 'edit_post', (int) $object_id );
	};
}

/**
 * Add a `frontendPath` field to REST responses, matching the GraphQL one.
 *
 * Saves API consumers reimplementing the WordPress→Astro URL mapping.
 */
function register_frontend_path(): void {
	$post_types = [ 'post', 'page', 'app_project', 'app_service' ];

	foreach ( $post_types as $post_type ) {
		register_rest_field(
			$post_type,
			'frontend_path',
			[
				'get_callback' => static function ( $post ) {
					if ( ! function_exists( '\\App\\Headless\\front_end_path_for_post' ) ) {
						return null;
					}

					$object = get_post( (int) ( $post['id'] ?? 0 ) );

					return $object instanceof \WP_Post ? \App\Headless\front_end_path_for_post( $object ) : null;
				},
				'schema'       => [
					'description' => __( 'Path of this content on the Astro front end.', 'app' ),
					'type'        => 'string',
					'context'     => [ 'view', 'edit' ],
				],
			]
		);
	}
}
add_action( 'rest_api_init', __NAMESPACE__ . '\\register_frontend_path' );
