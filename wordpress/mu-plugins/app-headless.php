<?php
/**
 * Plugin Name: App — Headless Behaviour
 * Description: Turns this WordPress into a pure content API for the Astro front end.
 * Version:     1.0.0
 *
 * Responsibilities:
 *  - send visitors hitting the WordPress front end to the Astro site
 *  - point "View"/"Preview" links in the admin at the Astro site
 *  - allow the Astro dev server to call /graphql cross-origin
 *  - ping a deploy hook when published content changes
 *  - a couple of small GraphQL additions the front end needs
 *
 * Configuration comes from wp-config.php constants (set by docker-compose.yml):
 *  APP_FRONTEND_URL, APP_PREVIEW_SECRET, APP_BUILD_HOOK_URL
 *
 * @package App
 */

declare( strict_types = 1 );

namespace App\Headless;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Base URL of the Astro front end, without a trailing slash.
 *
 * @return string
 */
function frontend_url(): string {
	$url = defined( 'APP_FRONTEND_URL' ) ? (string) APP_FRONTEND_URL : '';

	return untrailingslashit( $url );
}

/**
 * Post types that have a corresponding page on the front end.
 *
 * @return array<string,string> Post type => front-end path prefix.
 */
function routed_post_types(): array {
	return [
		'post'        => '/blog',
		'page'        => '',
		'app_project' => '/work',
		'app_service' => '/services',
	];
}

/* -------------------------------------------------------------------------
 * 1. Front end → Astro
 * ---------------------------------------------------------------------- */

/**
 * Redirect front-end requests to the Astro site.
 */
function redirect_front_end(): void {
	if ( '' === frontend_url() ) {
		return;
	}

	if ( is_admin() || wp_doing_ajax() || wp_doing_cron() ) {
		return;
	}

	if ( defined( 'REST_REQUEST' ) && REST_REQUEST ) {
		return;
	}

	if ( is_graphql_request() || is_robots() || is_feed() ) {
		return;
	}

	// Logged-in editors previewing a draft get sent to the preview route so
	// they still land somewhere useful.
	if ( is_preview() && is_singular() ) {
		$post = get_queried_object();

		if ( $post instanceof \WP_Post ) {
			wp_safe_redirect( preview_url( $post ), 302, 'App Headless' );
			exit;
		}
	}

	$target = frontend_url() . front_end_path_for_request();

	// 302 rather than 301: the mapping is config, not a permanent fact, and a
	// cached 301 is painful to undo in browsers.
	wp_redirect( $target, 302, 'App Headless' );
	exit;
}
add_action( 'template_redirect', __NAMESPACE__ . '\\redirect_front_end', 0 );

/**
 * Work out the front-end path for the current request.
 *
 * @return string Path beginning with a slash, or an empty string for the home page.
 */
function front_end_path_for_request(): string {
	if ( is_front_page() || is_home() ) {
		return '/';
	}

	if ( is_singular() ) {
		$post = get_queried_object();

		if ( $post instanceof \WP_Post ) {
			return front_end_path_for_post( $post );
		}
	}

	if ( is_post_type_archive( 'app_project' ) ) {
		return '/work';
	}

	if ( is_post_type_archive( 'app_service' ) ) {
		return '/services';
	}

	// Anything we do not explicitly map (category archives, search, 404s…)
	// goes to the home page rather than a guessed URL.
	return '/';
}

/**
 * Map a post to its path on the Astro site.
 *
 * @param \WP_Post $post Post.
 * @return string
 */
function front_end_path_for_post( \WP_Post $post ): string {
	$routes = routed_post_types();

	if ( ! isset( $routes[ $post->post_type ] ) ) {
		return '/';
	}

	if ( 'page' === $post->post_type ) {
		if ( (int) get_option( 'page_on_front' ) === $post->ID ) {
			return '/';
		}

		// Pages keep their full hierarchical path. get_page_uri() rather than
		// get_permalink(): get_permalink() applies the `page_link` filter, which
		// this file hooks, so using it here would recurse forever in wp-admin.
		$uri = get_page_uri( $post );

		return is_string( $uri ) && '' !== $uri ? '/' . trim( $uri, '/' ) : '/';
	}

	return $routes[ $post->post_type ] . '/' . $post->post_name;
}

/**
 * Build the Astro preview URL for a post.
 *
 * @param \WP_Post $post Post.
 * @return string
 */
function preview_url( \WP_Post $post ): string {
	$secret = defined( 'APP_PREVIEW_SECRET' ) ? (string) APP_PREVIEW_SECRET : '';

	return add_query_arg(
		array_filter(
			[
				'id'     => $post->ID,
				'type'   => $post->post_type,
				'secret' => $secret,
			]
		),
		frontend_url() . '/api/preview'
	);
}

/**
 * Rewrite the admin "View post" link.
 *
 * @param string  $permalink Permalink.
 * @param \WP_Post $post     Post.
 * @return string
 */
function filter_post_link( string $permalink, \WP_Post $post ): string {
	if ( '' === frontend_url() || ! is_admin() ) {
		return $permalink;
	}

	if ( ! isset( routed_post_types()[ $post->post_type ] ) ) {
		return $permalink;
	}

	return frontend_url() . front_end_path_for_post( $post );
}
add_filter( 'post_link', __NAMESPACE__ . '\\filter_post_link', 10, 2 );

/**
 * Rewrite the admin "View" link for custom post types.
 *
 * `post_type_link` passes the post object as its second argument, same as
 * `post_link`.
 *
 * @param string   $permalink Permalink.
 * @param \WP_Post $post      Post.
 * @return string
 */
function filter_post_type_link( string $permalink, \WP_Post $post ): string {
	return filter_post_link( $permalink, $post );
}
add_filter( 'post_type_link', __NAMESPACE__ . '\\filter_post_type_link', 10, 2 );

/**
 * Rewrite the admin "View page" link.
 *
 * Unlike `post_link` and `post_type_link`, the `page_link` filter passes a post
 * *ID* as its second argument, so it needs its own signature — passing an int
 * to filter_post_link()'s \WP_Post parameter is a fatal error under
 * strict_types.
 *
 * @param string $link    Page permalink.
 * @param int    $post_id Page ID.
 * @return string
 */
function filter_page_link( string $link, int $post_id ): string {
	$post = get_post( $post_id );

	return $post instanceof \WP_Post ? filter_post_link( $link, $post ) : $link;
}
add_filter( 'page_link', __NAMESPACE__ . '\\filter_page_link', 10, 2 );

/**
 * Rewrite the "Preview" button target.
 *
 * @param string   $link Preview link.
 * @param \WP_Post $post Post.
 * @return string
 */
function filter_preview_link( string $link, \WP_Post $post ): string {
	if ( '' === frontend_url() ) {
		return $link;
	}

	return preview_url( $post );
}
add_filter( 'preview_post_link', __NAMESPACE__ . '\\filter_preview_link', 10, 2 );

/* -------------------------------------------------------------------------
 * 2. CORS for the GraphQL endpoint
 * ---------------------------------------------------------------------- */

/**
 * Is the current request hitting the GraphQL endpoint?
 *
 * @return bool
 */
function is_graphql_request(): bool {
	if ( function_exists( 'is_graphql_http_request' ) && \is_graphql_http_request() ) {
		return true;
	}

	$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';

	return '' !== $uri && false !== strpos( $uri, '/graphql' );
}

/**
 * Origins allowed to call the GraphQL endpoint from a browser.
 *
 * Server-side builds do not need CORS at all — this exists so the Astro dev
 * server and any client-side queries work.
 *
 * @return array<int,string>
 */
function allowed_origins(): array {
	$origins = [];

	if ( '' !== frontend_url() ) {
		$origins[] = frontend_url();
	}

	// Vite/Astro dev servers.
	$origins[] = 'http://localhost:4321';
	$origins[] = 'http://127.0.0.1:4321';

	/**
	 * Filter the CORS allow-list.
	 *
	 * @param array $origins Allowed origins.
	 */
	return array_values( array_unique( (array) apply_filters( 'app_allowed_origins', $origins ) ) );
}

/**
 * Send CORS headers for GraphQL requests.
 *
 * @param array $headers Existing headers.
 * @return array
 */
function graphql_cors_headers( array $headers ): array {
	$origin = isset( $_SERVER['HTTP_ORIGIN'] ) ? (string) wp_unslash( $_SERVER['HTTP_ORIGIN'] ) : '';

	if ( '' === $origin || ! in_array( untrailingslashit( $origin ), allowed_origins(), true ) ) {
		return $headers;
	}

	$headers['Access-Control-Allow-Origin']      = untrailingslashit( $origin );
	$headers['Access-Control-Allow-Headers']     = 'Content-Type, Authorization, X-App-Preview';
	$headers['Access-Control-Allow-Methods']     = 'POST, GET, OPTIONS';
	$headers['Access-Control-Allow-Credentials'] = 'true';
	$headers['Vary']                             = 'Origin';

	return $headers;
}
add_filter( 'graphql_response_headers_to_send', __NAMESPACE__ . '\\graphql_cors_headers' );

/* -------------------------------------------------------------------------
 * 3. Deploy hook
 * ---------------------------------------------------------------------- */

/**
 * Ping the build hook when published content changes.
 *
 * Fires on any transition into or out of `publish` for a routed post type, so
 * publishing, updating and unpublishing all trigger a rebuild.
 *
 * @param string   $new_status New status.
 * @param string   $old_status Old status.
 * @param \WP_Post $post       Post.
 */
function trigger_build( string $new_status, string $old_status, \WP_Post $post ): void {
	$hook = build_hook_url();

	if ( '' === $hook ) {
		return;
	}

	if ( 'publish' !== $new_status && 'publish' !== $old_status ) {
		return;
	}

	if ( wp_is_post_revision( $post ) || wp_is_post_autosave( $post ) ) {
		return;
	}

	$tracked = array_merge( array_keys( routed_post_types() ), [ 'app_testimonial' ] );

	if ( ! in_array( $post->post_type, $tracked, true ) ) {
		return;
	}

	// Fire and forget — never make an editor wait on someone else's CI.
	wp_remote_post(
		$hook,
		[
			'timeout'  => 5,
			'blocking' => false,
			'headers'  => build_hook_headers(),
			'body'     => wp_json_encode(
				[
					'trigger'   => 'app-headless',
					'postType'  => $post->post_type,
					'postId'    => $post->ID,
					'newStatus' => $new_status,
					'oldStatus' => $old_status,
				]
			),
		]
	);
}

/**
 * The build hook URL.
 *
 * @return string Empty when no hook is configured.
 */
function build_hook_url(): string {
	$url = defined( 'APP_BUILD_HOOK_URL' ) ? trim( (string) APP_BUILD_HOOK_URL ) : '';

	/** Lets app-settings.php supply it from the admin screen. */
	return trim( (string) apply_filters( 'app_build_hook_url', $url ) );
}

/**
 * Headers for the build hook.
 *
 * Netlify and Vercel build hooks are unauthenticated URLs, but Coolify's deploy
 * endpoint (`POST /api/v1/deploy?uuid=…`) requires a bearer token, so the hook
 * has to be able to carry one. Set APP_BUILD_HOOK_AUTH in wp-config, or fill in
 * the field under Settings → App Settings.
 *
 * @return array<string,string>
 */
function build_hook_headers(): array {
	$headers = [ 'Content-Type' => 'application/json' ];

	$auth = defined( 'APP_BUILD_HOOK_AUTH' ) ? trim( (string) APP_BUILD_HOOK_AUTH ) : '';

	/** Lets app-settings.php supply the token from the admin screen. */
	$auth = (string) apply_filters( 'app_build_hook_auth', $auth );

	if ( '' !== $auth ) {
		// Accept a bare token or a full scheme; "Bearer x" and "x" both work.
		$headers['Authorization'] = preg_match( '/^\w+\s/', $auth ) ? $auth : 'Bearer ' . $auth;
	}

	return $headers;
}
add_action( 'transition_post_status', __NAMESPACE__ . '\\trigger_build', 10, 3 );

/* -------------------------------------------------------------------------
 * 4. Small GraphQL additions
 * ---------------------------------------------------------------------- */

/**
 * Add fields the front end needs that are not in the core schema.
 */
function register_graphql_extras(): void {
	if ( ! function_exists( 'register_graphql_field' ) ) {
		return;
	}

	// The front-end path for any content node, so Astro never has to
	// reimplement permalink logic.
	foreach ( [ 'Post', 'Page', 'Project', 'Service' ] as $type ) {
		register_graphql_field(
			$type,
			'frontendPath',
			[
				'type'        => 'String',
				'description' => __( 'Path of this content on the Astro front end.', 'app' ),
				'resolve'     => static function ( $source ) {
					$id   = $source->databaseId ?? $source->ID ?? null;
					$post = is_numeric( $id ) ? get_post( (int) $id ) : null;

					return $post instanceof \WP_Post ? front_end_path_for_post( $post ) : null;
				},
			]
		);
	}
}
add_action( 'graphql_register_types', __NAMESPACE__ . '\\register_graphql_extras' );

/* -------------------------------------------------------------------------
 * 5. Admin niceties
 * ---------------------------------------------------------------------- */

/**
 * Warn if a required plugin is missing — the schema silently loses fields
 * otherwise, which is a confusing thing to debug from the Astro side.
 */
function dependency_notice(): void {
	if ( ! current_user_can( 'activate_plugins' ) ) {
		return;
	}

	$missing = [];

	if ( ! function_exists( 'register_graphql_field' ) ) {
		$missing[] = 'WPGraphQL';
	}

	if ( ! function_exists( 'rwmb_meta' ) ) {
		$missing[] = 'Meta Box';
	}

	if ( [] === $missing ) {
		return;
	}

	printf(
		'<div class="notice notice-error"><p><strong>%s</strong> %s</p></div>',
		esc_html__( 'Headless setup:', 'app' ),
		esc_html(
			sprintf(
				/* translators: %s: comma-separated plugin names. */
				__( 'the following required plugins are not active: %s. The GraphQL schema will be incomplete until they are.', 'app' ),
				implode( ', ', $missing )
			)
		)
	);
}
add_action( 'admin_notices', __NAMESPACE__ . '\\dependency_notice' );

/**
 * Add a GraphQL endpoint link to the admin bar for quick access to GraphiQL.
 *
 * @param \WP_Admin_Bar $bar Admin bar.
 */
function admin_bar_link( \WP_Admin_Bar $bar ): void {
	if ( ! current_user_can( 'manage_options' ) || ! function_exists( 'register_graphql_field' ) ) {
		return;
	}

	$bar->add_node(
		[
			'id'    => 'app-graphiql',
			'title' => __( 'GraphiQL', 'app' ),
			'href'  => admin_url( 'admin.php?page=graphiql-ide' ),
		]
	);

	if ( '' !== frontend_url() ) {
		$bar->add_node(
			[
				'id'    => 'app-frontend',
				'title' => __( 'View Site (Astro)', 'app' ),
				'href'  => frontend_url(),
				'meta'  => [ 'target' => '_blank' ],
			]
		);
	}
}
add_action( 'admin_bar_menu', __NAMESPACE__ . '\\admin_bar_link', 80 );
