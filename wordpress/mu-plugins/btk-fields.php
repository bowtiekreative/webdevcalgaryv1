<?php
/**
 * Plugin Name: BTK — Meta Box Fields
 * Description: Meta Box (metabox.io) field groups for the headless content model.
 * Version:     1.0.0
 *
 * Every field group registered here is picked up automatically by
 * btk-graphql-metabox.php and exposed in the GraphQL schema. The GraphQL field
 * name for a group comes from `graphql_name` (falling back to a camelCased
 * `id`), and each field's name comes from its own `graphql_name` (falling back
 * to the field `id` with the `btk_` prefix stripped and camelCased).
 *
 * Only field types included in the FREE Meta Box plugin are used here, so this
 * works without any premium extensions. See wordpress/README.md for the list of
 * extensions you would need for groups, relationships and settings pages.
 *
 * @package BTK
 */

declare( strict_types = 1 );

namespace BTK\Fields;

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
		'id'           => 'btk_project_details',
		'title'        => __( 'Project Details', 'btk' ),
		'post_types'   => [ 'btk_project' ],
		'context'      => 'normal',
		'priority'     => 'high',
		'graphql_name' => 'projectDetails',
		'fields'       => [
			[
				'id'          => 'btk_project_client',
				'name'        => __( 'Client', 'btk' ),
				'type'        => 'text',
				'placeholder' => 'Acme Co.',
			],
			[
				'id'   => 'btk_project_year',
				'name' => __( 'Year', 'btk' ),
				'type' => 'number',
				'min'  => 1990,
				'max'  => 2100,
				'step' => 1,
			],
			[
				'id'   => 'btk_project_role',
				'name' => __( 'Our Role', 'btk' ),
				'type' => 'text',
				'desc' => __( 'e.g. Brand identity, art direction, web design', 'btk' ),
			],
			[
				'id'   => 'btk_project_summary',
				'name' => __( 'Short Summary', 'btk' ),
				'type' => 'textarea',
				'rows' => 3,
				'desc' => __( 'One or two sentences, used on cards and social previews.', 'btk' ),
			],
			[
				'id'         => 'btk_project_deliverables',
				'name'       => __( 'Deliverables', 'btk' ),
				'type'       => 'text',
				'clone'      => true,
				'sort_clone' => true,
				'desc'       => __( 'One per line. Rendered as a list on the project page.', 'btk' ),
			],
			[
				'id'          => 'btk_project_url',
				'name'        => __( 'Live URL', 'btk' ),
				'type'        => 'url',
				'placeholder' => 'https://',
			],
			[
				'id'   => 'btk_project_hero',
				'name' => __( 'Hero Image', 'btk' ),
				'type' => 'single_image',
				'desc' => __( 'Falls back to the featured image if empty.', 'btk' ),
			],
			[
				'id'               => 'btk_project_gallery',
				'name'             => __( 'Gallery', 'btk' ),
				'type'             => 'image_advanced',
				'max_file_uploads' => 24,
			],
			[
				'id'   => 'btk_project_featured',
				'name' => __( 'Feature on the home page', 'btk' ),
				'type' => 'checkbox',
			],
		],
	];

	/* ---------------------------------------------------------------------
	 * Services
	 * ------------------------------------------------------------------ */
	$meta_boxes[] = [
		'id'           => 'btk_service_details',
		'title'        => __( 'Service Details', 'btk' ),
		'post_types'   => [ 'btk_service' ],
		'graphql_name' => 'serviceDetails',
		'fields'       => [
			[
				'id'   => 'btk_service_tagline',
				'name' => __( 'Tagline', 'btk' ),
				'type' => 'text',
			],
			[
				'id'      => 'btk_service_icon',
				'name'    => __( 'Icon', 'btk' ),
				'type'    => 'select',
				'options' => [
					'brand'    => __( 'Brand', 'btk' ),
					'web'      => __( 'Web', 'btk' ),
					'print'    => __( 'Print', 'btk' ),
					'video'    => __( 'Video', 'btk' ),
					'social'   => __( 'Social', 'btk' ),
					'strategy' => __( 'Strategy', 'btk' ),
				],
				'placeholder' => __( 'Select an icon', 'btk' ),
			],
			[
				'id'         => 'btk_service_bullets',
				'name'       => __( "What's included", 'btk' ),
				'type'       => 'text',
				'clone'      => true,
				'sort_clone' => true,
			],
			[
				'id'          => 'btk_service_starting_price',
				'name'        => __( 'Starting Price', 'btk' ),
				'type'        => 'text',
				'placeholder' => '$2,500',
				'desc'        => __( 'Free text so you can write "from $2,500" or "Custom quote".', 'btk' ),
			],
		],
	];

	/* ---------------------------------------------------------------------
	 * Testimonials
	 * ------------------------------------------------------------------ */
	$meta_boxes[] = [
		'id'           => 'btk_testimonial_details',
		'title'        => __( 'Testimonial Details', 'btk' ),
		'post_types'   => [ 'btk_testimonial' ],
		'graphql_name' => 'testimonialDetails',
		'fields'       => [
			[
				'id'       => 'btk_testimonial_quote',
				'name'     => __( 'Quote', 'btk' ),
				'type'     => 'textarea',
				'rows'     => 4,
				'required' => true,
			],
			[
				'id'   => 'btk_testimonial_author',
				'name' => __( 'Author', 'btk' ),
				'type' => 'text',
			],
			[
				'id'   => 'btk_testimonial_role',
				'name' => __( 'Role', 'btk' ),
				'type' => 'text',
			],
			[
				'id'   => 'btk_testimonial_company',
				'name' => __( 'Company', 'btk' ),
				'type' => 'text',
			],
			[
				'id'   => 'btk_testimonial_photo',
				'name' => __( 'Photo', 'btk' ),
				'type' => 'single_image',
			],
			[
				'id'      => 'btk_testimonial_rating',
				'name'    => __( 'Rating', 'btk' ),
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
				'id'         => 'btk_testimonial_project',
				'name'       => __( 'Related Project', 'btk' ),
				'type'       => 'post',
				'post_type'  => 'btk_project',
				'field_type' => 'select_advanced',
			],
		],
	];

	/* ---------------------------------------------------------------------
	 * Page hero — attached to core Pages
	 * ------------------------------------------------------------------ */
	$meta_boxes[] = [
		'id'           => 'btk_page_hero',
		'title'        => __( 'Hero', 'btk' ),
		'post_types'   => [ 'page' ],
		'graphql_name' => 'hero',
		'fields'       => [
			[
				'id'   => 'btk_hero_eyebrow',
				'name' => __( 'Eyebrow', 'btk' ),
				'type' => 'text',
			],
			[
				'id'   => 'btk_hero_heading',
				'name' => __( 'Heading', 'btk' ),
				'type' => 'text',
				'desc' => __( 'Overrides the page title in the hero if set.', 'btk' ),
			],
			[
				'id'   => 'btk_hero_subheading',
				'name' => __( 'Subheading', 'btk' ),
				'type' => 'textarea',
				'rows' => 3,
			],
			[
				'id'   => 'btk_hero_image',
				'name' => __( 'Background Image', 'btk' ),
				'type' => 'single_image',
			],
			[
				'id'   => 'btk_hero_cta_label',
				'name' => __( 'CTA Label', 'btk' ),
				'type' => 'text',
			],
			[
				'id'   => 'btk_hero_cta_url',
				'name' => __( 'CTA URL', 'btk' ),
				'type' => 'url',
			],
		],
	];

	/* ---------------------------------------------------------------------
	 * SEO — attached to everything Astro renders as its own page
	 * ------------------------------------------------------------------ */
	$meta_boxes[] = [
		'id'           => 'btk_seo',
		'title'        => __( 'SEO & Social', 'btk' ),
		'post_types'   => [ 'post', 'page', 'btk_project', 'btk_service' ],
		'context'      => 'side',
		'priority'     => 'default',
		'graphql_name' => 'seo',
		'fields'       => [
			[
				'id'         => 'btk_seo_title',
				'name'       => __( 'Meta Title', 'btk' ),
				'type'       => 'text',
				'attributes' => [ 'maxlength' => 70 ],
			],
			[
				'id'         => 'btk_seo_description',
				'name'       => __( 'Meta Description', 'btk' ),
				'type'       => 'textarea',
				'rows'       => 3,
				'attributes' => [ 'maxlength' => 200 ],
			],
			[
				'id'   => 'btk_seo_image',
				'name' => __( 'Social Share Image', 'btk' ),
				'type' => 'single_image',
				'desc' => __( 'Recommended 1200×630.', 'btk' ),
			],
			[
				'id'   => 'btk_seo_noindex',
				'name' => __( 'Hide from search engines', 'btk' ),
				'type' => 'checkbox',
			],
		],
	];

	return $meta_boxes;
}
add_filter( 'rwmb_meta_boxes', __NAMESPACE__ . '\\register' );
