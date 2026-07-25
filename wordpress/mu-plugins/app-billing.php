<?php
/**
 * Plugin Name: App — Subscription State
 * Description: Stores each user's subscription on their WordPress account.
 * Version:     1.0.0
 *
 * Stripe and PayPal remain the source of truth for billing. This is a cache of
 * their answer, written by the webhook handlers in the Astro app, so the
 * dashboard can render a user's plan without an API round trip, and so staff
 * can see subscription state in wp-admin.
 *
 * No WooCommerce, no products, no orders — five meta fields on the user:
 *
 *   app_subscription_provider   'stripe' | 'paypal' | ''
 *   app_subscription_id         provider's subscription id
 *   app_subscription_status     'active'|'trialing'|'past_due'|'canceled'|'none'
 *   app_subscription_plan       plan key from web/src/config.ts
 *   app_subscription_renews_at  ISO-8601 timestamp, or ''
 *   app_stripe_customer_id      set once, reused for the billing portal
 *
 * Endpoint (Astro server only, shared-secret protected):
 *   POST /wp-json/app/v1/billing/{user_id}
 *
 * @package App
 */

declare( strict_types = 1 );

namespace App\Billing;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const META_PROVIDER    = 'app_subscription_provider';
const META_SUB_ID      = 'app_subscription_id';
const META_STATUS      = 'app_subscription_status';
const META_PLAN        = 'app_subscription_plan';
const META_RENEWS_AT   = 'app_subscription_renews_at';
const META_STRIPE_CUST = 'app_stripe_customer_id';

/** Statuses that grant access to paid areas. */
const ACTIVE_STATUSES = [ 'active', 'trialing' ];

/**
 * Read a user's subscription.
 *
 * @param int $user_id User ID.
 * @return array
 */
function get_subscription( int $user_id ): array {
	$status = (string) get_user_meta( $user_id, META_STATUS, true );
	$status = '' === $status ? 'none' : $status;

	return [
		'provider'  => (string) get_user_meta( $user_id, META_PROVIDER, true ),
		'id'        => (string) get_user_meta( $user_id, META_SUB_ID, true ),
		'status'    => $status,
		'plan'      => (string) get_user_meta( $user_id, META_PLAN, true ),
		'renewsAt'  => (string) get_user_meta( $user_id, META_RENEWS_AT, true ),
		'isActive'  => in_array( $status, ACTIVE_STATUSES, true ),
		'stripeCustomerId' => (string) get_user_meta( $user_id, META_STRIPE_CUST, true ),
	];
}

/**
 * Write a user's subscription.
 *
 * Only the keys present in $data are touched, so a webhook that knows the
 * status but not the plan does not blank the plan.
 *
 * @param int   $user_id User ID.
 * @param array $data    Partial subscription data.
 * @return array The stored subscription.
 */
function set_subscription( int $user_id, array $data ): array {
	$map = [
		'provider'         => META_PROVIDER,
		'id'               => META_SUB_ID,
		'status'           => META_STATUS,
		'plan'             => META_PLAN,
		'renewsAt'         => META_RENEWS_AT,
		'stripeCustomerId' => META_STRIPE_CUST,
	];

	foreach ( $map as $key => $meta_key ) {
		if ( ! array_key_exists( $key, $data ) ) {
			continue;
		}

		$value = $data[ $key ];

		if ( null === $value || '' === $value ) {
			delete_user_meta( $user_id, $meta_key );
			continue;
		}

		update_user_meta( $user_id, $meta_key, sanitize_text_field( (string) $value ) );
	}

	/**
	 * Fires after a subscription changes, for anything that needs to react
	 * (granting a role, sending a welcome email, …).
	 *
	 * @param int   $user_id User ID.
	 * @param array $data    The change that was applied.
	 */
	do_action( 'app_subscription_updated', $user_id, $data );

	return get_subscription( $user_id );
}

/* -------------------------------------------------------------------------
 * REST
 * ---------------------------------------------------------------------- */

/**
 * Read the {id} path segment.
 *
 * Explicitly the *URL* parameter, never $request['id']: WP_REST_Request
 * resolves parameters body-first, and the subscription payload has its own
 * `id` (the provider's subscription id), which silently shadowed the user id
 * and made every POST 404.
 *
 * @param \WP_REST_Request $request Request.
 * @return int
 */
function route_user_id( \WP_REST_Request $request ): int {
	$params = $request->get_url_params();

	return isset( $params['id'] ) ? (int) $params['id'] : 0;
}

/**
 * Register billing routes.
 */
function register_routes(): void {
	$guard = '\\App\\Auth\\require_shared_secret';

	register_rest_route(
		\App\Auth\NAMESPACE_V1,
		'/billing/(?P<id>\d+)',
		[
			[
				'methods'             => 'GET',
				'permission_callback' => $guard,
				'callback'            => static function ( \WP_REST_Request $request ) {
					return new \WP_REST_Response( [ 'subscription' => get_subscription( route_user_id( $request ) ) ], 200 );
				},
			],
			[
				'methods'             => 'POST',
				'permission_callback' => $guard,
				'callback'            => static function ( \WP_REST_Request $request ) {
					$user_id = route_user_id( $request );

					if ( ! get_user_by( 'id', $user_id ) ) {
						return new \WP_Error( 'app_no_user', __( 'No such user.', 'app' ), [ 'status' => 404 ] );
					}

					$payload = $request->get_json_params();

					if ( ! is_array( $payload ) ) {
						return new \WP_Error( 'app_bad_payload', __( 'Expected a JSON object.', 'app' ), [ 'status' => 400 ] );
					}

					return new \WP_REST_Response( [ 'subscription' => set_subscription( $user_id, $payload ) ], 200 );
				},
			],
		]
	);

	// Look a user up by Stripe customer id or subscription id. Webhooks arrive
	// carrying provider ids, not WordPress user ids.
	register_rest_route(
		\App\Auth\NAMESPACE_V1,
		'/billing/lookup',
		[
			'methods'             => 'GET',
			'permission_callback' => $guard,
			'callback'            => static function ( \WP_REST_Request $request ) {
				$by    = (string) $request->get_param( 'by' );
				$value = (string) $request->get_param( 'value' );

				$meta_key = [
					'stripe_customer' => META_STRIPE_CUST,
					'subscription'    => META_SUB_ID,
					'email'           => '',
				][ $by ] ?? null;

				if ( null === $meta_key || '' === $value ) {
					return new \WP_Error( 'app_bad_lookup', __( 'Unsupported lookup.', 'app' ), [ 'status' => 400 ] );
				}

				if ( 'email' === $by ) {
					$user = get_user_by( 'email', $value );
				} else {
					$found = get_users(
						[
							'meta_key'   => $meta_key,
							'meta_value' => $value,
							'number'     => 1,
							'fields'     => 'all',
						]
					);
					$user  = $found[0] ?? null;
				}

				if ( ! $user instanceof \WP_User ) {
					return new \WP_Error( 'app_no_user', __( 'No such user.', 'app' ), [ 'status' => 404 ] );
				}

				return new \WP_REST_Response(
					[ 'user' => [ 'id' => $user->ID, 'email' => $user->user_email ] ],
					200
				);
			},
		]
	);
}
add_action( 'rest_api_init', __NAMESPACE__ . '\\register_routes' );

/* -------------------------------------------------------------------------
 * Admin visibility
 * ---------------------------------------------------------------------- */

/**
 * Add a Subscription column to Users.
 *
 * @param array $columns Columns.
 * @return array
 */
function user_columns( array $columns ): array {
	$columns['app_subscription'] = __( 'Subscription', 'app' );

	return $columns;
}
add_filter( 'manage_users_columns', __NAMESPACE__ . '\\user_columns' );

/**
 * Render the Subscription column.
 *
 * @param string $output      Existing output.
 * @param string $column_name Column key.
 * @param int    $user_id     User ID.
 * @return string
 */
function user_column_content( string $output, string $column_name, int $user_id ): string {
	if ( 'app_subscription' !== $column_name ) {
		return $output;
	}

	$subscription = get_subscription( $user_id );

	if ( 'none' === $subscription['status'] ) {
		return '<span style="color:#888">' . esc_html__( 'Free', 'app' ) . '</span>';
	}

	$colour = $subscription['isActive'] ? '#1a7f37' : '#b35900';

	return sprintf(
		'<strong style="color:%s">%s</strong><br><small>%s%s</small>',
		esc_attr( $colour ),
		esc_html( ucfirst( $subscription['status'] ) ),
		esc_html( $subscription['plan'] ?: '—' ),
		$subscription['provider'] ? esc_html( ' · ' . $subscription['provider'] ) : ''
	);
}
add_filter( 'manage_users_custom_column', __NAMESPACE__ . '\\user_column_content', 10, 3 );

/**
 * Show subscription details on the user profile screen, read-only.
 *
 * Editing it by hand would only get overwritten by the next webhook, so it is
 * deliberately not a form.
 *
 * @param \WP_User $user User being edited.
 */
function profile_section( \WP_User $user ): void {
	if ( ! current_user_can( 'edit_users' ) ) {
		return;
	}

	$subscription = get_subscription( $user->ID );

	echo '<h2>' . esc_html__( 'Subscription', 'app' ) . '</h2>';
	echo '<p class="description">' . esc_html__( 'Read-only. Stripe and PayPal are authoritative; this is written by their webhooks.', 'app' ) . '</p>';
	echo '<table class="form-table"><tbody>';

	foreach (
		[
			__( 'Status', 'app' )   => $subscription['status'],
			__( 'Plan', 'app' )     => $subscription['plan'] ?: '—',
			__( 'Provider', 'app' ) => $subscription['provider'] ?: '—',
			__( 'Renews', 'app' )   => $subscription['renewsAt'] ?: '—',
			__( 'Ref', 'app' )      => $subscription['id'] ?: '—',
		] as $label => $value
	) {
		printf(
			'<tr><th>%s</th><td><code>%s</code></td></tr>',
			esc_html( (string) $label ),
			esc_html( (string) $value )
		);
	}

	echo '</tbody></table>';
}
add_action( 'show_user_profile', __NAMESPACE__ . '\\profile_section' );
add_action( 'edit_user_profile', __NAMESPACE__ . '\\profile_section' );
