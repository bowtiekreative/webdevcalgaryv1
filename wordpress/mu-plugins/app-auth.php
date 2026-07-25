<?php
/**
 * Plugin Name: App — Auth API
 * Description: Credential verification for the Astro dashboard. WordPress stays the user store.
 * Version:     1.0.0
 *
 * The Astro server posts credentials here, WordPress answers "yes/no plus who
 * they are", and Astro then runs its own session. WordPress never issues a
 * token the browser sees, and the browser never talks to these endpoints — only
 * the Astro *server* does.
 *
 * That is what the shared secret enforces. These routes hand out user data and
 * accept password attempts, so they must not be a public oracle:
 *
 *   - every route requires the X-App-Secret header to equal APP_SHARED_SECRET
 *   - without APP_SHARED_SECRET defined, the routes refuse to do anything
 *   - login attempts are rate limited per IP+login via a transient
 *   - a failed login returns one generic message, so the response cannot be
 *     used to tell "no such user" from "wrong password"
 *
 * Endpoints (all under /wp-json/app/v1):
 *   POST /auth/login          { login, password }  -> user object
 *   GET  /auth/user/{id}                           -> user object
 *   POST /auth/reset          { login }            -> always {ok:true}
 *
 * @package App
 */

declare( strict_types = 1 );

namespace App\Auth;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const NAMESPACE_V1 = 'app/v1';

/** Failed logins allowed per IP+login before a cool-off. */
const MAX_ATTEMPTS = 8;

/** Cool-off window in seconds. */
const ATTEMPT_WINDOW = 900;

/**
 * The shared secret the Astro server must present.
 *
 * @return string Empty when unset, which disables the API entirely.
 */
function shared_secret(): string {
	return defined( 'APP_SHARED_SECRET' ) ? (string) APP_SHARED_SECRET : '';
}

/**
 * Permission callback for every route here.
 *
 * @param \WP_REST_Request $request Request.
 * @return true|\WP_Error
 */
function require_shared_secret( \WP_REST_Request $request ) {
	$secret = shared_secret();

	if ( '' === $secret ) {
		return new \WP_Error(
			'app_auth_disabled',
			__( 'APP_SHARED_SECRET is not set in wp-config.php, so the auth API is disabled.', 'app' ),
			[ 'status' => 503 ]
		);
	}

	$provided = (string) $request->get_header( 'x-app-secret' );

	// hash_equals keeps the comparison constant-time.
	if ( '' === $provided || ! hash_equals( $secret, $provided ) ) {
		return new \WP_Error( 'app_forbidden', __( 'Bad or missing app secret.', 'app' ), [ 'status' => 401 ] );
	}

	return true;
}

/**
 * Shape a WP_User for the dashboard.
 *
 * Only fields the front end actually needs — no password hashes, no
 * capabilities dump.
 *
 * @param \WP_User $user User.
 * @return array
 */
function present_user( \WP_User $user ): array {
	return [
		'id'           => $user->ID,
		'email'        => $user->user_email,
		'login'        => $user->user_login,
		'displayName'  => $user->display_name ?: $user->user_login,
		'firstName'    => (string) get_user_meta( $user->ID, 'first_name', true ),
		'lastName'     => (string) get_user_meta( $user->ID, 'last_name', true ),
		'roles'        => array_values( $user->roles ),
		'avatarUrl'    => get_avatar_url( $user->ID, [ 'size' => 96 ] ),
		'registered'   => $user->user_registered,
		'subscription' => \App\Billing\get_subscription( $user->ID ),
	];
}

/**
 * Rate-limit key for a login attempt.
 *
 * @param string $login Login being attempted.
 * @return string
 */
function attempt_key( string $login ): string {
	$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? (string) wp_unslash( $_SERVER['REMOTE_ADDR'] ) : 'unknown';

	return 'app_login_' . md5( $ip . '|' . strtolower( $login ) );
}

/**
 * POST /auth/login
 *
 * @param \WP_REST_Request $request Request.
 * @return \WP_REST_Response|\WP_Error
 */
function handle_login( \WP_REST_Request $request ) {
	$login    = trim( (string) $request->get_param( 'login' ) );
	$password = (string) $request->get_param( 'password' );

	if ( '' === $login || '' === $password ) {
		return new \WP_Error( 'app_missing_credentials', __( 'Email and password are required.', 'app' ), [ 'status' => 400 ] );
	}

	$key      = attempt_key( $login );
	$attempts = (int) get_transient( $key );

	if ( $attempts >= MAX_ATTEMPTS ) {
		return new \WP_Error(
			'app_too_many_attempts',
			__( 'Too many attempts. Try again in a few minutes.', 'app' ),
			[ 'status' => 429 ]
		);
	}

	// wp_authenticate handles both a login name and an email address, and runs
	// the same filters (and brute-force plugins) as the normal login form.
	$user = wp_authenticate( $login, $password );

	if ( is_wp_error( $user ) ) {
		set_transient( $key, $attempts + 1, ATTEMPT_WINDOW );

		/**
		 * Fires on a failed dashboard login.
		 *
		 * @param string $login Attempted login.
		 */
		do_action( 'app_login_failed', $login );

		// One generic message: never reveal whether the account exists.
		return new \WP_Error(
			'app_invalid_credentials',
			__( 'Those credentials did not match.', 'app' ),
			[ 'status' => 401 ]
		);
	}

	delete_transient( $key );

	return new \WP_REST_Response( [ 'user' => present_user( $user ) ], 200 );
}

/**
 * GET /auth/user/{id}
 *
 * Lets the Astro session re-hydrate the user on each request without holding
 * stale role or subscription data in the session itself.
 *
 * @param \WP_REST_Request $request Request.
 * @return \WP_REST_Response|\WP_Error
 */
function handle_get_user( \WP_REST_Request $request ) {
	$user = get_user_by( 'id', (int) $request['id'] );

	if ( ! $user instanceof \WP_User ) {
		return new \WP_Error( 'app_no_user', __( 'No such user.', 'app' ), [ 'status' => 404 ] );
	}

	return new \WP_REST_Response( [ 'user' => present_user( $user ) ], 200 );
}

/**
 * POST /auth/reset
 *
 * Triggers WordPress's own password-reset email, which goes out through
 * Emailit if app-emailit.php is configured.
 *
 * Always reports success: whether an address is registered is not something an
 * unauthenticated caller should be able to probe.
 *
 * @param \WP_REST_Request $request Request.
 * @return \WP_REST_Response
 */
function handle_reset( \WP_REST_Request $request ): \WP_REST_Response {
	$login = trim( (string) $request->get_param( 'login' ) );

	if ( '' !== $login ) {
		$user = is_email( $login ) ? get_user_by( 'email', $login ) : get_user_by( 'login', $login );

		if ( $user instanceof \WP_User ) {
			retrieve_password( $user->user_login );
		}
	}

	return new \WP_REST_Response( [ 'ok' => true ], 200 );
}

/**
 * Register the routes.
 */
function register_routes(): void {
	register_rest_route(
		NAMESPACE_V1,
		'/auth/login',
		[
			'methods'             => 'POST',
			'callback'            => __NAMESPACE__ . '\\handle_login',
			'permission_callback' => __NAMESPACE__ . '\\require_shared_secret',
			'args'                => [
				'login'    => [ 'required' => true, 'type' => 'string' ],
				'password' => [ 'required' => true, 'type' => 'string' ],
			],
		]
	);

	register_rest_route(
		NAMESPACE_V1,
		'/auth/user/(?P<id>\d+)',
		[
			'methods'             => 'GET',
			'callback'            => __NAMESPACE__ . '\\handle_get_user',
			'permission_callback' => __NAMESPACE__ . '\\require_shared_secret',
		]
	);

	register_rest_route(
		NAMESPACE_V1,
		'/auth/users',
		[
			'methods'             => 'GET',
			'permission_callback' => __NAMESPACE__ . '\\require_shared_secret',
			'callback'            => static function ( \WP_REST_Request $request ) {
				// Bounded: the dashboard's user table is not a data export tool.
				$per_page = min( 200, max( 1, (int) ( $request->get_param( 'per_page' ) ?: 50 ) ) );

				$query = new \WP_User_Query(
					[
						'number'  => $per_page,
						'paged'   => max( 1, (int) ( $request->get_param( 'page' ) ?: 1 ) ),
						'orderby' => 'registered',
						'order'   => 'DESC',
						'search'  => $request->get_param( 'search' )
							? '*' . esc_attr( (string) $request->get_param( 'search' ) ) . '*'
							: '',
					]
				);

				return new \WP_REST_Response(
					[
						'users' => array_map( __NAMESPACE__ . '\\present_user', $query->get_results() ),
						'total' => (int) $query->get_total(),
					],
					200
				);
			},
		]
	);

	register_rest_route(
		NAMESPACE_V1,
		'/auth/reset',
		[
			'methods'             => 'POST',
			'callback'            => __NAMESPACE__ . '\\handle_reset',
			'permission_callback' => __NAMESPACE__ . '\\require_shared_secret',
		]
	);
}
add_action( 'rest_api_init', __NAMESPACE__ . '\\register_routes' );

/**
 * Warn in the admin when the secret is missing, since the dashboard silently
 * cannot log anyone in without it.
 */
function missing_secret_notice(): void {
	if ( ! current_user_can( 'manage_options' ) || '' !== shared_secret() ) {
		return;
	}

	printf(
		'<div class="notice notice-warning"><p>%s</p></div>',
		esc_html__(
			'APP_SHARED_SECRET is not defined in wp-config.php. The Astro dashboard cannot sign anyone in until it is set to the same value as WP_SHARED_SECRET in web/.env.',
			'app'
		)
	);
}
add_action( 'admin_notices', __NAMESPACE__ . '\\missing_secret_notice' );
