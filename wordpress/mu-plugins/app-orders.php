<?php
/**
 * Plugin Name: App — Orders & Leads
 * Description: The funnel's job queue: every lead and every paid order lands here.
 * Version:     1.0.0
 *
 * WebDevCalgary sells one-time offers (the $497 rush fee, the $47 teardown, the
 * $97 GBP bump) alongside the monthly plans. PayPal is the source of truth for
 * the money; this is the operational record — what was bought, by whom, and
 * when it has to be live.
 *
 * No WooCommerce. A private post type and a handful of meta fields, because the
 * whole catalogue is six fixed offers defined in web/src/config.ts and a cart
 * that can never contain anything else.
 *
 * Status lives in the post status rather than a meta field so the wp-admin list
 * table filters by it for free:
 *
 *   app-lead      form submitted, nothing paid — call this person back
 *   app-pending   PayPal order created, not captured yet
 *   app-paid      captured. The clock is running.
 *   app-building  someone is on it
 *   publish       live
 *   app-refunded  rush fee returned (we missed the window)
 *
 * Endpoints (Astro server only, shared-secret protected):
 *   POST /wp-json/app/v1/orders          create or update by reference
 *   GET  /wp-json/app/v1/orders/{ref}    read one back
 *
 * @package App
 */

declare( strict_types = 1 );

namespace App\Orders;

use App\Auth;
use WP_Error;
use WP_Post;
use WP_Query;
use WP_REST_Request;
use WP_REST_Response;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const POST_TYPE = 'app_order';

/** Our reference (WDC-XXXXXXXX), which is also what PayPal echoes back. */
const META_REFERENCE = 'app_order_reference';

/**
 * Meta key => sanitiser. Anything not in this map is dropped, so a compromised
 * front end cannot write arbitrary post meta.
 */
function fields(): array {
	return [
		'app_order_reference'   => 'sanitize_text_field',
		'app_order_provider'    => 'sanitize_text_field',
		'app_order_provider_id' => 'sanitize_text_field',
		'app_order_capture_id'  => 'sanitize_text_field',
		'app_order_amount'      => __NAMESPACE__ . '\\sanitize_amount',
		'app_order_currency'    => 'sanitize_text_field',
		'app_order_offers'      => 'sanitize_text_field',
		'app_order_plan'        => 'sanitize_key',
		'app_order_speed'       => 'sanitize_key',
		'app_order_name'        => 'sanitize_text_field',
		'app_order_business'    => 'sanitize_text_field',
		'app_order_email'       => 'sanitize_email',
		'app_order_phone'       => 'sanitize_text_field',
		'app_order_website'     => 'esc_url_raw',
		'app_order_notes'       => 'sanitize_textarea_field',
		'app_order_source'      => 'sanitize_text_field',
		'app_order_go_live_at'  => 'sanitize_text_field',
	];
}

/**
 * Amounts are money — keep two decimals and never let a string through.
 *
 * @param mixed $value Raw value.
 * @return string
 */
function sanitize_amount( $value ): string {
	return number_format( (float) $value, 2, '.', '' );
}

/** Post statuses this type uses, beyond WordPress's own. */
function statuses(): array {
	return [
		'app-lead'     => __( 'Lead', 'app' ),
		'app-pending'  => __( 'Awaiting payment', 'app' ),
		'app-paid'     => __( 'Paid — clock running', 'app' ),
		'app-building' => __( 'Building', 'app' ),
		'app-refunded' => __( 'Refunded', 'app' ),
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
				'name'          => __( 'Orders', 'app' ),
				'singular_name' => __( 'Order', 'app' ),
				'menu_name'     => __( 'Orders', 'app' ),
				'search_items'  => __( 'Search orders', 'app' ),
				'not_found'     => __( 'No orders yet.', 'app' ),
			],
			// Never public: these hold customer phone numbers and emails.
			'public'          => false,
			'show_ui'         => true,
			'show_in_menu'    => true,
			'menu_icon'       => 'dashicons-clipboard',
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
				/* translators: %s: number of orders. */
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
 * Find an order by our reference.
 *
 * @param string $reference Order reference.
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
 * Create or update an order, keyed on its reference.
 *
 * Idempotent on purpose: the capture endpoint and the PayPal webhook can both
 * arrive, in either order, and must not produce two records.
 *
 * @param array $data Order data. 'reference' is required.
 * @return int|WP_Error Post ID.
 */
function upsert( array $data ) {
	$reference = sanitize_text_field( (string) ( $data['reference'] ?? '' ) );

	if ( '' === $reference ) {
		return new WP_Error( 'app_order_no_reference', __( 'An order reference is required.', 'app' ), [ 'status' => 400 ] );
	}

	$existing = find( $reference );
	$status   = sanitize_key( (string) ( $data['status'] ?? 'app-lead' ) );

	if ( ! array_key_exists( $status, statuses() ) && 'publish' !== $status ) {
		$status = 'app-lead';
	}

	$business = sanitize_text_field( (string) ( $data['business'] ?? '' ) );
	$name     = sanitize_text_field( (string) ( $data['name'] ?? '' ) );
	$title    = trim( $reference . ' — ' . ( '' !== $business ? $business : $name ) );

	$postarr = [
		'post_type'   => POST_TYPE,
		'post_title'  => '' !== trim( $title, ' —' ) ? $title : $reference,
		'post_status' => $status,
	];

	if ( $existing instanceof WP_Post ) {
		$postarr['ID'] = $existing->ID;

		// Never walk a paid order backwards because a late webhook says
		// "pending" — that would hide a job somebody already paid for.
		if ( 'app-paid' === $existing->post_status && in_array( $status, [ 'app-lead', 'app-pending' ], true ) ) {
			unset( $postarr['post_status'] );
		}
	}

	$post_id = wp_insert_post( $postarr, true );

	if ( is_wp_error( $post_id ) ) {
		return $post_id;
	}

	$map = fields();

	// 'reference' arrives without the prefix; everything else maps 1:1.
	$incoming = [ 'app_order_reference' => $reference ];

	foreach ( $map as $meta_key => $sanitizer ) {
		$short = str_replace( 'app_order_', '', $meta_key );

		if ( 'reference' === $short ) {
			continue;
		}

		// Accept both camelCase (what the Astro app sends) and snake_case.
		$camel = lcfirst( str_replace( ' ', '', ucwords( str_replace( '_', ' ', $short ) ) ) );

		if ( array_key_exists( $camel, $data ) ) {
			$incoming[ $meta_key ] = $data[ $camel ];
		} elseif ( array_key_exists( $short, $data ) ) {
			$incoming[ $meta_key ] = $data[ $short ];
		}
	}

	foreach ( $incoming as $meta_key => $value ) {
		if ( null === $value || '' === $value ) {
			continue;
		}

		if ( is_array( $value ) ) {
			$value = implode( ',', array_map( 'strval', $value ) );
		}

		$sanitizer = $map[ $meta_key ] ?? 'sanitize_text_field';

		update_post_meta( $post_id, $meta_key, call_user_func( $sanitizer, $value ) );
	}

	return $post_id;
}

/**
 * Shape an order for the API.
 *
 * @param WP_Post $post Order post.
 * @return array
 */
function to_array( WP_Post $post ): array {
	$out = [
		'id'     => $post->ID,
		'status' => $post->post_status,
		'date'   => get_post_time( 'c', true, $post ),
	];

	foreach ( array_keys( fields() ) as $meta_key ) {
		$short         = str_replace( 'app_order_', '', $meta_key );
		$camel         = lcfirst( str_replace( ' ', '', ucwords( str_replace( '_', ' ', $short ) ) ) );
		$out[ $camel ] = (string) get_post_meta( $post->ID, $meta_key, true );
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
		'/orders',
		[
			'methods'             => 'POST',
			'callback'            => __NAMESPACE__ . '\\handle_upsert',
			'permission_callback' => $guard,
		]
	);

	register_rest_route(
		'app/v1',
		'/orders/(?P<reference>[A-Za-z0-9\-]+)',
		[
			'methods'             => 'GET',
			'callback'            => __NAMESPACE__ . '\\handle_get',
			'permission_callback' => $guard,
		]
	);
}
add_action( 'rest_api_init', __NAMESPACE__ . '\\register_routes' );

/**
 * POST /wp-json/app/v1/orders
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function handle_upsert( WP_REST_Request $request ) {
	$data    = (array) $request->get_json_params();
	$post_id = upsert( $data );

	if ( is_wp_error( $post_id ) ) {
		return $post_id;
	}

	$post = get_post( $post_id );

	return new WP_REST_Response( $post instanceof WP_Post ? to_array( $post ) : [], 200 );
}

/**
 * GET /wp-json/app/v1/orders/{reference}
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function handle_get( WP_REST_Request $request ) {
	$post = find( (string) $request['reference'] );

	if ( ! $post instanceof WP_Post ) {
		return new WP_Error( 'app_order_not_found', __( 'No such order.', 'app' ), [ 'status' => 404 ] );
	}

	return new WP_REST_Response( to_array( $post ), 200 );
}

/* -------------------------------------------------------------------------
 * wp-admin: make the list table useful without opening every order
 * ---------------------------------------------------------------------- */

/**
 * @param array $columns Existing columns.
 * @return array
 */
function admin_columns( array $columns ): array {
	$date = $columns['date'] ?? '';
	unset( $columns['date'] );

	$columns['app_order_state']   = __( 'Status', 'app' );
	$columns['app_order_who']     = __( 'Contact', 'app' );
	$columns['app_order_bought']  = __( 'Bought', 'app' );
	$columns['app_order_total']   = __( 'Total', 'app' );
	$columns['app_order_go_live'] = __( 'Live by', 'app' );
	$columns['date']              = $date;

	return $columns;
}
add_filter( 'manage_' . POST_TYPE . '_posts_columns', __NAMESPACE__ . '\\admin_columns' );

/**
 * @param string $column  Column key.
 * @param int    $post_id Post ID.
 */
function admin_column_content( string $column, int $post_id ): void {
	switch ( $column ) {
		case 'app_order_state':
			$status = get_post_status( $post_id );
			$labels = statuses();
			echo esc_html( $labels[ $status ] ?? ucfirst( (string) $status ) );
			break;

		case 'app_order_who':
			$email = (string) get_post_meta( $post_id, 'app_order_email', true );
			$phone = (string) get_post_meta( $post_id, 'app_order_phone', true );

			if ( '' !== $email ) {
				printf( '<a href="mailto:%1$s">%1$s</a><br>', esc_attr( $email ) );
			}

			echo esc_html( $phone );
			break;

		case 'app_order_bought':
			$offers = (string) get_post_meta( $post_id, 'app_order_offers', true );
			$plan   = (string) get_post_meta( $post_id, 'app_order_plan', true );

			echo esc_html( trim( $offers . ( '' !== $plan ? ' · ' . $plan : '' ), ' ·' ) );
			break;

		case 'app_order_total':
			$amount = (string) get_post_meta( $post_id, 'app_order_amount', true );

			if ( '' !== $amount ) {
				echo esc_html( '$' . $amount . ' ' . (string) get_post_meta( $post_id, 'app_order_currency', true ) );
			}
			break;

		case 'app_order_go_live':
			$due = (string) get_post_meta( $post_id, 'app_order_go_live_at', true );

			if ( '' === $due ) {
				break;
			}

			$timestamp = strtotime( $due );
			$overdue   = $timestamp && $timestamp < time() && 'publish' !== get_post_status( $post_id );

			printf(
				'<span style="%s">%s</span>',
				$overdue ? 'color:#a83a1c;font-weight:700' : '',
				esc_html( $timestamp ? wp_date( 'D j M, g:ia', $timestamp ) : $due )
			);
			break;
	}
}
add_action( 'manage_' . POST_TYPE . '_posts_custom_column', __NAMESPACE__ . '\\admin_column_content', 10, 2 );

/**
 * Newest first, and show the custom statuses in the post list.
 *
 * @param WP_Query $query Query.
 */
function admin_query( WP_Query $query ): void {
	if ( ! is_admin() || ! $query->is_main_query() || POST_TYPE !== $query->get( 'post_type' ) ) {
		return;
	}

	if ( '' === (string) $query->get( 'post_status' ) ) {
		$query->set( 'post_status', array_merge( array_keys( statuses() ), [ 'publish' ] ) );
	}
}
add_action( 'pre_get_posts', __NAMESPACE__ . '\\admin_query' );
