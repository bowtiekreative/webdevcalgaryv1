<?php
/**
 * Plugin Name: App — Post Types & Taxonomies
 * Description: Content model for the headless site. Every type is exposed to WPGraphQL.
 * Version:     1.0.0
 *
 * WPGraphQL derives schema names from `graphql_single_name` / `graphql_plural_name`,
 * so those must be unique across the whole schema and must not collide with
 * built-in types (Post, Page, Category, Tag, User, MediaItem, Menu...).
 *
 * @package App
 */

declare( strict_types = 1 );

namespace App\PostTypes;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Register the custom post types.
 */
function register_post_types(): void {
	register_post_type(
		'app_project',
		[
			'labels'              => [
				'name'          => __( 'Projects', 'app' ),
				'singular_name' => __( 'Project', 'app' ),
				'menu_name'     => __( 'Work', 'app' ),
				'add_new_item'  => __( 'Add New Project', 'app' ),
				'edit_item'     => __( 'Edit Project', 'app' ),
			],
			'public'              => true,
			// Keep the single views queryable so admin "Preview" works; the
			// front end itself is redirected to Astro by app-headless.php.
			'publicly_queryable'  => true,
			'has_archive'         => true,
			'hierarchical'        => false,
			'menu_icon'           => 'dashicons-portfolio',
			'menu_position'       => 21,
			'supports'            => [ 'title', 'editor', 'excerpt', 'thumbnail', 'revisions', 'custom-fields', 'page-attributes' ],
			'rewrite'             => [ 'slug' => 'work', 'with_front' => false ],
			'show_in_rest'        => true,
			'rest_base'           => 'projects',
			'show_in_graphql'     => true,
			'graphql_single_name' => 'project',
			'graphql_plural_name' => 'projects',
		]
	);

	register_post_type(
		'app_service',
		[
			'labels'              => [
				'name'          => __( 'Services', 'app' ),
				'singular_name' => __( 'Service', 'app' ),
				'add_new_item'  => __( 'Add New Service', 'app' ),
				'edit_item'     => __( 'Edit Service', 'app' ),
			],
			'public'              => true,
			'publicly_queryable'  => true,
			'has_archive'         => true,
			'hierarchical'        => false,
			'menu_icon'           => 'dashicons-screenoptions',
			'menu_position'       => 22,
			'supports'            => [ 'title', 'editor', 'excerpt', 'thumbnail', 'revisions', 'custom-fields', 'page-attributes' ],
			'rewrite'             => [ 'slug' => 'services', 'with_front' => false ],
			'show_in_rest'        => true,
			'rest_base'           => 'services',
			'show_in_graphql'     => true,
			'graphql_single_name' => 'service',
			'graphql_plural_name' => 'services',
		]
	);

	register_post_type(
		'app_testimonial',
		[
			'labels'              => [
				'name'          => __( 'Testimonials', 'app' ),
				'singular_name' => __( 'Testimonial', 'app' ),
				'add_new_item'  => __( 'Add New Testimonial', 'app' ),
				'edit_item'     => __( 'Edit Testimonial', 'app' ),
			],
			/*
			 * Testimonials are only rendered as part of another page, so they
			 * need no front-end URL of their own — hence publicly_queryable
			 * false and no archive.
			 *
			 * `public` must still be true: WPGraphQL treats a post type as
			 * private unless `public === true || publicly_queryable === true`
			 * (see Model/Post.php), and a private type returns an empty list to
			 * unauthenticated requests. With public false the build silently
			 * loaded zero testimonials.
			 */
			'public'              => true,
			'publicly_queryable'  => false,
			'exclude_from_search' => true,
			'show_in_nav_menus'   => false,
			'show_ui'             => true,
			'has_archive'         => false,
			'hierarchical'        => false,
			'menu_icon'           => 'dashicons-format-quote',
			'menu_position'       => 23,
			'supports'            => [ 'title', 'editor', 'thumbnail', 'revisions', 'custom-fields', 'page-attributes' ],
			'show_in_rest'        => true,
			'rest_base'           => 'testimonials',
			'show_in_graphql'     => true,
			'graphql_single_name' => 'testimonial',
			'graphql_plural_name' => 'testimonials',
		]
	);
}
add_action( 'init', __NAMESPACE__ . '\\register_post_types' );

/**
 * Register taxonomies.
 */
function register_taxonomies(): void {
	register_taxonomy(
		'app_capability',
		[ 'app_project', 'app_service' ],
		[
			'labels'              => [
				'name'          => __( 'Capabilities', 'app' ),
				'singular_name' => __( 'Capability', 'app' ),
			],
			'public'              => true,
			'hierarchical'        => false,
			'show_admin_column'   => true,
			'rewrite'             => [ 'slug' => 'capability', 'with_front' => false ],
			'show_in_rest'        => true,
			'show_in_graphql'     => true,
			'graphql_single_name' => 'capability',
			'graphql_plural_name' => 'capabilities',
		]
	);

	register_taxonomy(
		'app_industry',
		[ 'app_project' ],
		[
			'labels'              => [
				'name'          => __( 'Industries', 'app' ),
				'singular_name' => __( 'Industry', 'app' ),
			],
			'public'              => true,
			'hierarchical'        => true,
			'show_admin_column'   => true,
			'rewrite'             => [ 'slug' => 'industry', 'with_front' => false ],
			'show_in_rest'        => true,
			'show_in_graphql'     => true,
			'graphql_single_name' => 'industry',
			'graphql_plural_name' => 'industries',
		]
	);
}
add_action( 'init', __NAMESPACE__ . '\\register_taxonomies' );

/**
 * Expose the core Post/Page menu order so Astro can sort by it, and make sure
 * projects/services sort by menu_order by default in the admin and in queries.
 *
 * @param \WP_Query $query Current query.
 */
function default_ordering( \WP_Query $query ): void {
	if ( ! $query->is_main_query() ) {
		return;
	}

	$post_type = $query->get( 'post_type' );

	if ( in_array( $post_type, [ 'app_project', 'app_service' ], true ) && ! $query->get( 'orderby' ) ) {
		$query->set( 'orderby', [ 'menu_order' => 'ASC', 'date' => 'DESC' ] );
	}
}
add_action( 'pre_get_posts', __NAMESPACE__ . '\\default_ordering' );

/**
 * Flush rewrite rules once after this plugin's rules change.
 *
 * mu-plugins have no activation hook, so we version the rules and flush when
 * the stored version does not match.
 */
function maybe_flush_rewrites(): void {
	$version = '1.0.1';

	// During `wp core install` this fires on init before wp_options exists,
	// which fills the log with "Table 'wp_options' doesn't exist" on every
	// fresh install. The rules get flushed on the next request anyway.
	if ( wp_installing() ) {
		return;
	}

	if ( get_option( 'app_rewrite_version' ) === $version ) {
		return;
	}

	flush_rewrite_rules();
	update_option( 'app_rewrite_version', $version );
}
add_action( 'init', __NAMESPACE__ . '\\maybe_flush_rewrites', 99 );
