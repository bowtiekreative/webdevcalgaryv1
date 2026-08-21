<?php
/**
 * Plugin Name: App — Leads
 * Description: The funnel's callback queue: every qualified lead lands here.
 * Version:     2.0.0
 *
 * WebDevCalgary sells nothing self-serve. The site's only conversion is a
 * qualification form, so a lead is the whole product of a visit and this is
 * where the work happens.
 *
 * No WooCommerce, no orders, no payments. A private post type and a handful of
 * meta fields, because the entire model is five multiple-choice answers plus
 * contact details.
 *
 * Two axes, kept deliberately separate:
 *
 *   status  — where the lead *is* in the pipeline (a person decides this)
 *   grade   — how good it looked on arrival (the scorer decides this)
 *
 * Keeping them apart means a cold lead that buys anyway, or a hot one that
 * ghosts, is just data — not a reason to change the scoring model.
 *
 * Status lives in the post status rather than a meta field so the wp-admin list
 * table filters by it for free:
 *
 *   app-new        submitted, nobody has looked yet
 *   app-qualified  worth pursuing
 *   app-nurture    real, but not in market yet
 *   app-contacted  we have reached out
 *   app-won        became a client
 *   app-lost       no
 *
 * Endpoints (Astro server only, shared-secret protected):
 *   POST  /wp-json/app/v1/leads              create or update by reference
 *   GET   /wp-json/app/v1/leads              list, with filters
 *   GET   /wp-json/app/v1/leads/{reference}  read one back
 *   PATCH /wp-json/app/v1/leads/{reference}  update status / notes / fields
 *
 * @package App
 */

declare( strict_types = 1 );

namespace App\Leads;

use WP_Error;
use WP_Post;
use WP_Query;
use WP_REST_Request;
use WP_REST_Response;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const POST_TYPE = 'app_lead';

/** Our reference (WDC-XXXXXXXX), the key everything is addressed by. */
const META_REFERENCE = 'app_lead_reference';

/**
 * Meta key => sanitiser. Anything not in this map is dropped, so a compromised
 * front end cannot write arbitrary post meta.
 */
function fields(): array {
	return [
		'app_lead_reference'  => 'sanitize_text_field',
		'app_lead_name'       => 'sanitize_text_field',
		'app_lead_business'   => 'sanitize_text_field',
		'app_lead_email'      => 'sanitize_email',
		'app_lead_phone'      => 'sanitize_text_field',
		'app_lead_website'    => 'esc_url_raw',
		'app_lead_notes'      => 'sanitize_textarea_field',
		'app_lead_source'     => 'sanitize_text_field',
		// Qualification answers, stored as the choice ids from web/src/config.ts.
		'app_lead_trade'      => 'sanitize_key',
		'app_lead_site_state' => 'sanitize_key',
		'app_lead_timeline'   => 'sanitize_key',
		'app_lead_role'       => 'sanitize_key',
		'app_lead_budget'     => 'sanitize_key',
		'app_lead_score'      => __NAMESPACE__ . '\\sanitize_score',
		'app_lead_grade'      => 'sanitize_key',
		// Free-text notes added by staff after a call, newest first.
		'app_lead_log'        => 'sanitize_textarea_field',
	];
}

/**
 * Scores are 0-100 integers. Clamped rather than rejected so a scoring change
 * can never produce a lead that refuses to save.
 *
 * @param mixed $value Raw value.
 * @return string
 */
function sanitize_score( $value ): string {
	return (string) max( 0, min( 100, (int) $value ) );
}

/** Post statuses this type uses, beyond WordPress's own. */
function statuses(): array {
	return [
		'app-new'       => __( 'New', 'app' ),
		'app-qualified' => __( 'Qualified', 'app' ),
		'app-nurture'   => __( 'Nurture', 'app' ),
		'app-contacted' => __( 'Contacted', 'app' ),
		'app-won'       => __( 'Won', 'app' ),
		'app-lost'      => __( 'Lost', 'app' ),
	];
}

/**
 * Register the post type, its statuses and its meta.
 */
function register(): void {
	register_post_type(
		POST_TYPE,
		[
			'labels'          => [
				'name'          => __( 'Leads', 'app' ),
				'singular_name' => __( 'Lead', 'app' ),
				'menu_name'     => __( 'Leads', 'app' ),
				'search_items'  => __( 'Search leads', 'app' ),
				'not_found'     => __( 'No leads yet.', 'app' ),
			],
			// Never public: these hold customer phone numbers and emails.
			'public'          => false,
			'show_ui'         => true,
			'show_in_menu'    => true,
			'menu_icon'       => 'dashicons-phone',
			'menu_position'   => 26,
			'supports'        => [ 'title', 'custom-fields' ],
			'capability_type' => 'post',
			'map_meta_cap'    => true,
			'show_in_rest'    => false,
		]
	);

	foreach ( statuses() as $slug => $label ) {
		register_post_status(
			$slug,
			[
				'label'                     => $label,
				'public'                    => false,
				'internal'                  => false,
				'protected'                 => true,
				'show_in_admin_all_list'    => true,
				'show_in_admin_status_list' => true,
				/* translators: %s: number of leads. */
				'label_count'               => _n_noop( $label . ' <span class="count">(%s)</span>', $label . ' <span class="count">(%s)</span>', 'app' ),
			]
		);
	}

	foreach ( fields() as $key => $sanitizer ) {
		register_post_meta(
			POST_TYPE,
			$key,
			[
				'type'              => 'string',
				'single'            => true,
				'sanitize_callback' => $sanitizer,
				'show_in_rest'      => false,
				'auth_callback'     => static fn (): bool => current_user_can( 'edit_posts' ),
			]
		);
	}
}
add_action( 'init', __NAMESPACE__ . '\\register' );

/**
 * camelCase (what the Astro app and the MCP server send) => meta key.
 *
 * Spelled out rather than derived: `siteState` does not mechanically become
 * `app_lead_site_state`, and a clever transform that mostly works is worse
 * than a table you can read.
 */
function key_map(): array {
	return [
		'reference' => 'app_lead_reference',
		'name'      => 'app_lead_name',
		'business'  => 'app_lead_business',
		'email'     => 'app_lead_email',
		'phone'     => 'app_lead_phone',
		'website'   => 'app_lead_website',
		'notes'     => 'app_lead_notes',
		'source'    => 'app_lead_source',
		'trade'     => 'app_lead_trade',
		'siteState' => 'app_lead_site_state',
		'timeline'  => 'app_lead_timeline',
		'role'      => 'app_lead_role',
		'budget'    => 'app_lead_budget',
		'score'     => 'app_lead_score',
		'grade'     => 'app_lead_grade',
		'log'       => 'app_lead_log',
	];
}

/**
 * Find a lead by our reference.
 *
 * @param string $reference Lead reference.
 * @return WP_Post|null
 */
function find( string $reference ): ?WP_Post {
	if ( '' === $reference ) {
		return null;
	}

	$query = new WP_Query(
		[
			'post_type'              => POST_TYPE,
			'post_status'            => 'any',
			'posts_per_page'         => 1,
			'no_found_rows'          => true,
			'update_post_term_cache' => false,
			'meta_query'             => [
				[
					'key'   => META_REFERENCE,
					'value' => $reference,
				],
			],
		]
	);

	return $query->posts[0] ?? null;
}

/**
 * Create or update a lead, keyed on its reference.
 *
 * Idempotent on purpose: a retried submission must not produce two records.
 *
 * @param array $data  Lead data. 'reference' is required.
 * @param bool  $patch When true, only the keys present are touched and the
 *                     status is left alone unless explicitly given.
 * @return int|WP_Error Post ID.
 */
function upsert( array $data, bool $patch = false ) {
	$reference = sanitize_text_field( (string) ( $data['reference'] ?? '' ) );

	if ( '' === $reference ) {
		return new WP_Error( 'app_lead_no_reference', __( 'A lead reference is required.', 'app' ), [ 'status' => 400 ] );
	}

	$existing = find( $reference );

	if ( $patch && ! $existing instanceof WP_Post ) {
		return new WP_Error( 'app_lead_not_found', __( 'No such lead.', 'app' ), [ 'status' => 404 ] );
	}

	$postarr = [ 'post_type' => POST_TYPE ];

	if ( array_key_exists( 'status', $data ) ) {
		$status = sanitize_key( (string) $data['status'] );

		if ( ! array_key_exists( $status, statuses() ) ) {
			return new WP_Error(
				'app_lead_bad_status',
				sprintf(
					/* translators: %s: comma-separated list of valid statuses. */
					__( 'Unknown status. Expected one of: %s', 'app' ),
					implode( ', ', array_keys( statuses() ) )
				),
				[ 'status' => 400 ]
			);
		}

		$postarr['post_status'] = $status;
	} elseif ( ! $patch ) {
		$postarr['post_status'] = 'app-new';
	}

	$business = sanitize_text_field( (string) ( $data['business'] ?? '' ) );
	$name     = sanitize_text_field( (string) ( $data['name'] ?? '' ) );
	$title    = trim( $reference . ' — ' . ( '' !== $business ? $business : $name ) );

	if ( $existing instanceof WP_Post ) {
		$postarr['ID'] = $existing->ID;

		// wp_insert_post() fills defaults for anything absent, including on an
		// update — so omitting post_status here silently moves the lead to
		// 'draft' and drops it out of every pipeline view. Carry the current
		// status forward unless the caller explicitly asked to change it.
		if ( ! isset( $postarr['post_status'] ) ) {
			$postarr['post_status'] = $existing->post_status;
		}

		if ( ! $patch || '' !== trim( $title, ' —' ) ) {
			$postarr['post_title'] = '' !== trim( $title, ' —' ) ? $title : $existing->post_title;
		}
	} else {
		$postarr['post_title'] = '' !== trim( $title, ' —' ) ? $title : $reference;
	}

	$post_id = wp_insert_post( $postarr, true );

	if ( is_wp_error( $post_id ) ) {
		return $post_id;
	}

	$map       = key_map();
	$sanitizers = fields();
	$incoming  = [ 'app_lead_reference' => $reference ];

	foreach ( $map as $short => $meta_key ) {
		if ( 'reference' === $short || ! array_key_exists( $short, $data ) ) {
			continue;
		}

		$incoming[ $meta_key ] = $data[ $short ];
	}

	foreach ( $incoming as $meta_key => $value ) {
		if ( null === $value ) {
			continue;
		}

		// A PATCH may legitimately clear a field; a create never should, so an
		// empty value on create is skipped rather than written.
		if ( '' === $value && ! $patch ) {
			continue;
		}

		if ( is_array( $value ) ) {
			$value = implode( ',', array_map( 'strval', $value ) );
		}

		$sanitizer = $sanitizers[ $meta_key ] ?? 'sanitize_text_field';

		update_post_meta( $post_id, $meta_key, call_user_func( $sanitizer, $value ) );
	}

	return $post_id;
}

/**
 * Shape a lead for the API.
 *
 * @param WP_Post $post Lead post.
 * @return array
 */
function to_array( WP_Post $post ): array {
	$out = [
		'id'       => $post->ID,
		'status'   => $post->post_status,
		'date'     => get_post_time( 'c', true, $post ),
		'modified' => get_post_modified_time( 'c', true, $post ),
	];

	foreach ( key_map() as $short => $meta_key ) {
		$value = (string) get_post_meta( $post->ID, $meta_key, true );

		$out[ $short ] = 'score' === $short ? (int) $value : $value;
	}

	return $out;
}

/**
 * Register the REST routes.
 */
function register_routes(): void {
	$guard = '\\App\\Auth\\require_shared_secret';

	register_rest_route(
		'app/v1',
		'/leads',
		[
			[
				'methods'             => 'POST',
				'callback'            => __NAMESPACE__ . '\\handle_upsert',
				'permission_callback' => $guard,
			],
			[
				'methods'             => 'GET',
				'callback'            => __NAMESPACE__ . '\\handle_list',
				'permission_callback' => $guard,
			],
		]
	);

	register_rest_route(
		'app/v1',
		'/leads/(?P<reference>[A-Za-z0-9\-]+)',
		[
			[
				'methods'             => 'GET',
				'callback'            => __NAMESPACE__ . '\\handle_get',
				'permission_callback' => $guard,
			],
			[
				'methods'             => 'PATCH',
				'callback'            => __NAMESPACE__ . '\\handle_patch',
				'permission_callback' => $guard,
			],
		]
	);

	register_rest_route(
		'app/v1',
		'/leads-stats',
		[
			'methods'             => 'GET',
			'callback'            => __NAMESPACE__ . '\\handle_stats',
			'permission_callback' => $guard,
		]
	);
}
add_action( 'rest_api_init', __NAMESPACE__ . '\\register_routes' );

/**
 * POST /wp-json/app/v1/leads
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function handle_upsert( WP_REST_Request $request ) {
	$post_id = upsert( (array) $request->get_json_params() );

	if ( is_wp_error( $post_id ) ) {
		return $post_id;
	}

	$post = get_post( $post_id );

	return new WP_REST_Response( $post instanceof WP_Post ? to_array( $post ) : [], 200 );
}

/**
 * PATCH /wp-json/app/v1/leads/{reference}
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function handle_patch( WP_REST_Request $request ) {
	$data              = (array) $request->get_json_params();
	$data['reference'] = (string) $request['reference'];

	$post_id = upsert( $data, true );

	if ( is_wp_error( $post_id ) ) {
		return $post_id;
	}

	$post = get_post( $post_id );

	return new WP_REST_Response( $post instanceof WP_Post ? to_array( $post ) : [], 200 );
}

/**
 * GET /wp-json/app/v1/leads/{reference}
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function handle_get( WP_REST_Request $request ) {
	$post = find( (string) $request['reference'] );

	if ( ! $post instanceof WP_Post ) {
		return new WP_Error( 'app_lead_not_found', __( 'No such lead.', 'app' ), [ 'status' => 404 ] );
	}

	return new WP_REST_Response( to_array( $post ), 200 );
}

/**
 * GET /wp-json/app/v1/leads?status=&grade=&search=&per_page=&page=
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response
 */
function handle_list( WP_REST_Request $request ): WP_REST_Response {
	$status = sanitize_key( (string) $request->get_param( 'status' ) );
	$grade  = sanitize_key( (string) $request->get_param( 'grade' ) );
	$search = sanitize_text_field( (string) $request->get_param( 'search' ) );
	$per    = (int) ( $request->get_param( 'per_page' ) ?: 20 );
	$page   = max( 1, (int) ( $request->get_param( 'page' ) ?: 1 ) );

	$args = [
		'post_type'      => POST_TYPE,
		'post_status'    => array_key_exists( $status, statuses() ) ? $status : array_keys( statuses() ),
		'posts_per_page' => max( 1, min( 100, $per ) ),
		'paged'          => $page,
		// Highest score first: the queue is only useful in priority order.
		'meta_key'       => 'app_lead_score',
		'orderby'        => [ 'meta_value_num' => 'DESC', 'date' => 'DESC' ],
	];

	if ( '' !== $search ) {
		$args['s'] = $search;
	}

	if ( '' !== $grade ) {
		$args['meta_query'] = [
			[
				'key'   => 'app_lead_grade',
				'value' => $grade,
			],
		];
	}

	$query = new WP_Query( $args );

	return new WP_REST_Response(
		[
			'total' => (int) $query->found_posts,
			'pages' => (int) $query->max_num_pages,
			'page'  => $page,
			'leads' => array_map( __NAMESPACE__ . '\\to_array', $query->posts ),
		],
		200
	);
}

/**
 * GET /wp-json/app/v1/leads-stats
 *
 * @return WP_REST_Response
 */
function handle_stats(): WP_REST_Response {
	$counts = [];

	foreach ( array_keys( statuses() ) as $status ) {
		$query             = new WP_Query(
			[
				'post_type'      => POST_TYPE,
				'post_status'    => $status,
				'posts_per_page' => 1,
				'fields'         => 'ids',
			]
		);
		$counts[ $status ] = (int) $query->found_posts;
	}

	$grades = [];

	foreach ( [ 'hot', 'warm', 'cold' ] as $grade ) {
		$query           = new WP_Query(
			[
				'post_type'      => POST_TYPE,
				'post_status'    => array_keys( statuses() ),
				'posts_per_page' => 1,
				'fields'         => 'ids',
				'meta_query'     => [
					[
						'key'   => 'app_lead_grade',
						'value' => $grade,
					],
				],
			]
		);
		$grades[ $grade ] = (int) $query->found_posts;
	}

	return new WP_REST_Response(
		[
			'byStatus' => $counts,
			'byGrade'  => $grades,
			'total'    => array_sum( $counts ),
		],
		200
	);
}

/* -------------------------------------------------------------------------
 * wp-admin: make the queue workable without opening every lead
 * ---------------------------------------------------------------------- */

/**
 * @param array $columns Existing columns.
 * @return array
 */
function admin_columns( array $columns ): array {
	$date = $columns['date'] ?? '';
	unset( $columns['date'] );

	$columns['app_lead_grade']   = __( 'Grade', 'app' );
	$columns['app_lead_state']   = __( 'Status', 'app' );
	$columns['app_lead_who']     = __( 'Contact', 'app' );
	$columns['app_lead_answers'] = __( 'Qualification', 'app' );
	$columns['date']             = $date;

	return $columns;
}
add_filter( 'manage_' . POST_TYPE . '_posts_columns', __NAMESPACE__ . '\\admin_columns' );

/**
 * @param string $column  Column key.
 * @param int    $post_id Post ID.
 */
function admin_column_content( string $column, int $post_id ): void {
	switch ( $column ) {
		case 'app_lead_grade':
			$grade = (string) get_post_meta( $post_id, 'app_lead_grade', true );
			$score = (int) get_post_meta( $post_id, 'app_lead_score', true );

			// The one column worth colour. A queue you have to read carefully
			// is a queue nobody works.
			$colour = [
				'hot'  => '#a83a1c',
				'warm' => '#8a6d00',
				'cold' => '#6f695d',
			][ $grade ] ?? '#6f695d';

			printf(
				'<strong style="color:%s;text-transform:uppercase;letter-spacing:.06em">%s</strong><br><span style="color:#666">%d/100</span>',
				esc_attr( $colour ),
				esc_html( '' !== $grade ? $grade : '—' ),
				(int) $score
			);
			break;

		case 'app_lead_state':
			$labels = statuses();
			$status = (string) get_post_status( $post_id );
			echo esc_html( $labels[ $status ] ?? ucfirst( $status ) );
			break;

		case 'app_lead_who':
			$email = (string) get_post_meta( $post_id, 'app_lead_email', true );
			$phone = (string) get_post_meta( $post_id, 'app_lead_phone', true );

			if ( '' !== $phone ) {
				printf( '<a href="tel:%1$s"><strong>%1$s</strong></a><br>', esc_attr( $phone ) );
			}

			if ( '' !== $email ) {
				printf( '<a href="mailto:%1$s">%1$s</a>', esc_attr( $email ) );
			}
			break;

		case 'app_lead_answers':
			$parts = [];

			foreach ( [ 'app_lead_trade', 'app_lead_timeline', 'app_lead_budget' ] as $key ) {
				$value = (string) get_post_meta( $post_id, $key, true );

				if ( '' !== $value ) {
					$parts[] = $value;
				}
			}

			echo esc_html( $parts ? implode( ' · ', $parts ) : '—' );
			break;
	}
}
add_action( 'manage_' . POST_TYPE . '_posts_custom_column', __NAMESPACE__ . '\\admin_column_content', 10, 2 );

/**
 * Show every custom status in the default list view, best leads first.
 *
 * @param WP_Query $query Query.
 */
function admin_query( WP_Query $query ): void {
	if ( ! is_admin() || ! $query->is_main_query() || POST_TYPE !== $query->get( 'post_type' ) ) {
		return;
	}

	if ( '' === (string) $query->get( 'post_status' ) ) {
		$query->set( 'post_status', array_keys( statuses() ) );
	}

	if ( '' === (string) $query->get( 'orderby' ) ) {
		$query->set( 'meta_key', 'app_lead_score' );
		$query->set( 'orderby', [ 'meta_value_num' => 'DESC', 'date' => 'DESC' ] );
	}
}
add_action( 'pre_get_posts', __NAMESPACE__ . '\\admin_query' );
