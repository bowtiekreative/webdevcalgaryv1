<?php
/**
 * Plugin Name: App — Meta Box Fields
 * Description: Meta Box (metabox.io) field groups for the headless content model.
 * Version:     1.0.0
 *
 * Every field group registered here is picked up automatically by
 * app-graphql-metabox.php and exposed in the GraphQL schema. The GraphQL field
 * name for a group comes from `graphql_name` (falling back to a camelCased
 * `id`), and each field's name comes from its own `graphql_name` (falling back
 * to the field `id` with the `app_` prefix stripped and camelCased).
 *
 * Only field types included in the FREE Meta Box plugin are used here, so this
 * works without any premium extensions. See wordpress/README.md for the list of
 * extensions you would need for groups, relationships and settings pages.
 *
 * @package App
 */

declare( strict_types = 1 );

namespace App\Fields;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Register all field groups.
 *
 * @param array $meta_boxes Existing meta boxes.
 * @return array
 */
function register( array $meta_boxes ): array {

	/* ---------------------------------------------------------------------
	 * Projects
	 * ------------------------------------------------------------------ */
	$meta_boxes[] = [
		'id'           => 'app_project_details',
		'title'        => __( 'Project Details', 'app' ),
		'post_types'   => [ 'app_project' ],
		'context'      => 'normal',
		'priority'     => 'high',
		'graphql_name' => 'projectDetails',
		'fields'       => [
			[
				'id'          => 'app_project_client',
				'name'        => __( 'Client', 'app' ),
				'type'        => 'text',
				'placeholder' => 'Acme Co.',
			],
			[
				'id'   => 'app_project_year',
				'name' => __( 'Year', 'app' ),
				'type' => 'number',
				'min'  => 1990,
				'max'  => 2100,
				'step' => 1,
			],
			[
				'id'   => 'app_project_role',
				'name' => __( 'Our Role', 'app' ),
				'type' => 'text',
				'desc' => __( 'e.g. Brand identity, art direction, web design', 'app' ),
			],
			[
				'id'   => 'app_project_summary',
				'name' => __( 'Short Summary', 'app' ),
				'type' => 'textarea',
				'rows' => 3,
				'desc' => __( 'One or two sentences, used on cards and social previews.', 'app' ),
			],
			[
				'id'         => 'app_project_deliverables',
				'name'       => __( 'Deliverables', 'app' ),
				'type'       => 'text',
				'clone'      => true,
				'sort_clone' => true,
				'desc'       => __( 'One per line. Rendered as a list on the project page.', 'app' ),
			],
			[
				'id'          => 'app_project_url',
				'name'        => __( 'Live URL', 'app' ),
				'type'        => 'url',
				'placeholder' => 'https://',
			],
			[
				'id'   => 'app_project_hero',
				'name' => __( 'Hero Image', 'app' ),
				'type' => 'single_image',
				'desc' => __( 'Falls back to the featured image if empty.', 'app' ),
			],
			[
				'id'               => 'app_project_gallery',
				'name'             => __( 'Gallery', 'app' ),
				'type'             => 'image_advanced',
				'max_file_uploads' => 24,
			],
			[
				'id'   => 'app_project_featured',
				'name' => __( 'Feature on the home page', 'app' ),
				'type' => 'checkbox',
			],
		],
	];

	/* ---------------------------------------------------------------------
	 * Services
	 * ------------------------------------------------------------------ */
	$meta_boxes[] = [
		'id'           => 'app_service_details',
		'title'        => __( 'Service Details', 'app' ),
		'post_types'   => [ 'app_service' ],
		'graphql_name' => 'serviceDetails',
		'fields'       => [
			[
				'id'   => 'app_service_tagline',
				'name' => __( 'Tagline', 'app' ),
				'type' => 'text',
			],
			[
				'id'      => 'app_service_icon',
				'name'    => __( 'Icon', 'app' ),
				'type'    => 'select',
				'options' => [
					'brand'    => __( 'Brand', 'app' ),
					'web'      => __( 'Web', 'app' ),
					'print'    => __( 'Print', 'app' ),
					'video'    => __( 'Video', 'app' ),
					'social'   => __( 'Social', 'app' ),
					'strategy' => __( 'Strategy', 'app' ),
				],
				'placeholder' => __( 'Select an icon', 'app' ),
			],
			[
				'id'         => 'app_service_bullets',
				'name'       => __( "What's included", 'app' ),
				'type'       => 'text',
				'clone'      => true,
				'sort_clone' => true,
			],
			[
				'id'          => 'app_service_starting_price',
				'name'        => __( 'Starting Price', 'app' ),
				'type'        => 'text',
				'placeholder' => '$2,500',
				'desc'        => __( 'Free text so you can write "from $2,500" or "Custom quote".', 'app' ),
			],
		],
	];

	/* ---------------------------------------------------------------------
	 * Testimonials
	 * ------------------------------------------------------------------ */
	$meta_boxes[] = [
		'id'           => 'app_testimonial_details',
		'title'        => __( 'Testimonial Details', 'app' ),
		'post_types'   => [ 'app_testimonial' ],
		'graphql_name' => 'testimonialDetails',
		'fields'       => [
			[
				'id'       => 'app_testimonial_quote',
				'name'     => __( 'Quote', 'app' ),
				'type'     => 'textarea',
				'rows'     => 4,
				'required' => true,
			],
			[
				'id'   => 'app_testimonial_author',
				'name' => __( 'Author', 'app' ),
				'type' => 'text',
			],
			[
				'id'   => 'app_testimonial_role',
				'name' => __( 'Role', 'app' ),
				'type' => 'text',
			],
			[
				'id'   => 'app_testimonial_company',
				'name' => __( 'Company', 'app' ),
				'type' => 'text',
			],
			[
				'id'   => 'app_testimonial_photo',
				'name' => __( 'Photo', 'app' ),
				'type' => 'single_image',
			],
			[
				'id'      => 'app_testimonial_rating',
				'name'    => __( 'Rating', 'app' ),
				'type'    => 'select',
				'options' => [
					'5' => '5',
					'4' => '4',
					'3' => '3',
					'2' => '2',
					'1' => '1',
				],
				'std'     => '5',
			],
			[
				'id'         => 'app_testimonial_project',
				'name'       => __( 'Related Project', 'app' ),
				'type'       => 'post',
				'post_type'  => 'app_project',
				'field_type' => 'select_advanced',
			],
		],
	];

	/* ---------------------------------------------------------------------
	 * Page hero — attached to core Pages
	 * ------------------------------------------------------------------ */
	$meta_boxes[] = [
		'id'           => 'app_page_hero',
		'title'        => __( 'Hero', 'app' ),
		'post_types'   => [ 'page' ],
		'graphql_name' => 'hero',
		'fields'       => [
			[
				'id'   => 'app_hero_eyebrow',
				'name' => __( 'Eyebrow', 'app' ),
				'type' => 'text',
			],
			[
				'id'   => 'app_hero_heading',
				'name' => __( 'Heading', 'app' ),
				'type' => 'text',
				'desc' => __( 'Overrides the page title in the hero if set.', 'app' ),
			],
			[
				'id'   => 'app_hero_subheading',
				'name' => __( 'Subheading', 'app' ),
				'type' => 'textarea',
				'rows' => 3,
			],
			[
				'id'   => 'app_hero_image',
				'name' => __( 'Background Image', 'app' ),
				'type' => 'single_image',
			],
			[
				'id'   => 'app_hero_cta_label',
				'name' => __( 'CTA Label', 'app' ),
				'type' => 'text',
			],
			[
				'id'   => 'app_hero_cta_url',
				'name' => __( 'CTA URL', 'app' ),
				'type' => 'url',
			],
		],
	];

	/* ---------------------------------------------------------------------
	 * SEO — attached to everything Astro renders as its own page
	 * ------------------------------------------------------------------ */
	$meta_boxes[] = [
		'id'           => 'app_seo',
		'title'        => __( 'SEO & Social', 'app' ),
		'post_types'   => [ 'post', 'page', 'app_project', 'app_service' ],
		'context'      => 'side',
		'priority'     => 'default',
		'graphql_name' => 'seo',
		'fields'       => [
			[
				'id'         => 'app_seo_title',
				'name'       => __( 'Meta Title', 'app' ),
				'type'       => 'text',
				'attributes' => [ 'maxlength' => 70 ],
			],
			[
				'id'         => 'app_seo_description',
				'name'       => __( 'Meta Description', 'app' ),
				'type'       => 'textarea',
				'rows'       => 3,
				'attributes' => [ 'maxlength' => 200 ],
			],
			[
				'id'   => 'app_seo_image',
				'name' => __( 'Social Share Image', 'app' ),
				'type' => 'single_image',
				'desc' => __( 'Recommended 1200×630.', 'app' ),
			],
			[
				'id'   => 'app_seo_noindex',
				'name' => __( 'Hide from search engines', 'app' ),
				'type' => 'checkbox',
			],
		],
	];

	return $meta_boxes;
}
add_filter( 'rwmb_meta_boxes', __NAMESPACE__ . '\\register' );
