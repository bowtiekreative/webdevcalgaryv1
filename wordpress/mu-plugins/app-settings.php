<?php
/**
 * Plugin Name: App — Settings
 * Description: Admin UI for API keys and maintenance mode, plus the endpoint Astro reads them from.
 * Version:     1.0.0
 *
 * Adds "App Settings" to wp-admin so keys can be managed without editing .env
 * and redeploying. Built on the core Settings API rather than MB Settings Page,
 * which is a paid Meta Box extension.
 *
 * Precedence: an environment variable on the Astro side always wins over what
 * is stored here. Env is the safer place for production secrets — it is not in
 * the database, not in backups, and not readable by anyone who gets a WordPress
 * admin session. This screen exists for convenience and for people who would
 * rather not redeploy to rotate a key; the UI says so.
 *
 * Secrets are write-only in the UI: stored values are shown masked, and
 * submitting an unchanged masked value leaves the stored secret alone.
 *
 * Endpoint (Astro server only, shared-secret protected):
 *   GET /wp-json/app/v1/settings
 *
 * @package App
 */

declare( strict_types = 1 );

namespace App\Settings;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const OPTION = 'app_settings';

/** What a masked secret looks like coming back from the form. */
const MASK = '••••••••';

/**
 * Every setting, grouped for display.
 *
 * `secret` fields are masked in the UI and never echoed back in full.
 *
 * @return array<string,array{title:string,description:string,fields:array<string,array>}>
 */
function schema(): array {
	return [
		'stripe'   => [
			'title'       => __( 'Stripe', 'app' ),
			'description' => __( 'Subscriptions via Stripe Checkout. Dashboard → Developers → API keys.', 'app' ),
			'fields'      => [
				'stripe_secret_key'     => [ 'label' => __( 'Secret key', 'app' ), 'secret' => true, 'placeholder' => 'sk_test_…' ],
				'stripe_webhook_secret' => [ 'label' => __( 'Webhook signing secret', 'app' ), 'secret' => true, 'placeholder' => 'whsec_…' ],
				'stripe_price_starter'  => [ 'label' => __( 'Price ID — Starter', 'app' ), 'placeholder' => 'price_…' ],
				'stripe_price_studio'   => [ 'label' => __( 'Price ID — Studio', 'app' ), 'placeholder' => 'price_…' ],
			],
		],
		'paypal'   => [
			'title'       => __( 'PayPal', 'app' ),
			'description' => __( 'Subscriptions via the PayPal Subscriptions API. developer.paypal.com → Apps & Credentials.', 'app' ),
			'fields'      => [
				'paypal_env'           => [
					'label'   => __( 'Environment', 'app' ),
					'type'    => 'select',
					'options' => [ 'sandbox' => 'Sandbox', 'live' => 'Live' ],
				],
				'paypal_client_id'     => [ 'label' => __( 'Client ID', 'app' ) ],
				'paypal_client_secret' => [ 'label' => __( 'Client secret', 'app' ), 'secret' => true ],
				'paypal_webhook_id'    => [
					'label' => __( 'Webhook ID', 'app' ),
					'desc'  => __( 'Required — without it every PayPal webhook is rejected.', 'app' ),
				],
				'paypal_plan_starter'  => [ 'label' => __( 'Plan ID — Starter', 'app' ), 'placeholder' => 'P-…' ],
				'paypal_plan_studio'   => [ 'label' => __( 'Plan ID — Studio', 'app' ), 'placeholder' => 'P-…' ],
			],
		],
		'emailit'  => [
			'title'       => __( 'Emailit', 'app' ),
			'description' => __( 'Transactional mail and campaign sending. emailit.com → workspace settings.', 'app' ),
			'fields'      => [
				'emailit_api_key'    => [ 'label' => __( 'API key', 'app' ), 'secret' => true ],
				'emailit_from'       => [
					'label'       => __( 'From address', 'app' ),
					'placeholder' => 'Studio <hello@example.com>',
					'desc'        => __( 'Must be on a domain verified in Emailit.', 'app' ),
				],
				'emailit_rate_limit' => [
					'label' => __( 'Messages per second', 'app' ),
					'type'  => 'number',
					'desc'  => __( 'New workspaces are capped at 2/second and 5,000/day.', 'app' ),
				],
			],
		],
		'site'     => [
			'title'       => __( 'Maintenance & Coming Soon', 'app' ),
			'description' => __( 'Takes effect immediately — the front end checks this on every request, no rebuild needed.', 'app' ),
			'fields'      => [
				'site_mode'            => [
					'label'   => __( 'Site mode', 'app' ),
					'type'    => 'select',
					'options' => [
						'live'        => __( 'Live — normal', 'app' ),
						'coming_soon' => __( 'Coming soon (200)', 'app' ),
						'maintenance' => __( 'Maintenance (503)', 'app' ),
					],
					'desc'    => __( 'Coming soon returns 200 so it can be indexed; maintenance returns 503 so search engines keep the old listing.', 'app' ),
				],
				'site_mode_heading'    => [ 'label' => __( 'Heading', 'app' ), 'placeholder' => 'Something good is coming' ],
				'site_mode_message'    => [ 'label' => __( 'Message', 'app' ), 'type' => 'textarea' ],
				'site_mode_until'      => [
					'label'       => __( 'Back online (optional)', 'app' ),
					'placeholder' => '2026-08-01 09:00',
					'desc'        => __( 'Shown to visitors, and sent as Retry-After in maintenance mode.', 'app' ),
				],
				'site_mode_allow_ips'  => [
					'label' => __( 'Always allow these IPs', 'app' ),
					'desc'  => __( 'Comma separated. Signed-in administrators always bypass regardless.', 'app' ),
				],
			],
		],
	];
}

/** Flat map of field key => config. */
function fields(): array {
	$out = [];

	foreach ( schema() as $group ) {
		foreach ( $group['fields'] as $key => $config ) {
			$out[ $key ] = $config;
		}
	}

	return $out;
}

/**
 * All stored settings.
 *
 * @return array<string,string>
 */
function all(): array {
	$stored = get_option( OPTION, [] );

	return is_array( $stored ) ? $stored : [];
}

/**
 * One setting.
 *
 * @param string $key     Field key.
 * @param string $default Fallback.
 * @return string
 */
function get( string $key, string $default = '' ): string {
	$value = all()[ $key ] ?? '';

	return '' === $value ? $default : (string) $value;
}

/* -------------------------------------------------------------------------
 * Admin screen
 * ---------------------------------------------------------------------- */

/**
 * Register the settings page.
 */
function add_menu(): void {
	add_options_page(
		__( 'App Settings', 'app' ),
		__( 'App Settings', 'app' ),
		'manage_options',
		'app-settings',
		__NAMESPACE__ . '\\render_page'
	);
}
add_action( 'admin_menu', __NAMESPACE__ . '\\add_menu' );

/**
 * Register the option and its sanitiser.
 */
function register(): void {
	register_setting(
		'app_settings_group',
		OPTION,
		[
			'type'              => 'array',
			'sanitize_callback' => __NAMESPACE__ . '\\sanitize',
			'default'           => [],
		]
	);
}
add_action( 'admin_init', __NAMESPACE__ . '\\register' );

/**
 * Sanitise submitted settings.
 *
 * A secret submitted as the mask means "unchanged" — the real value is kept.
 * That is what makes the fields safe to render without ever printing a live key
 * into the HTML.
 *
 * @param mixed $input Raw submission.
 * @return array
 */
function sanitize( $input ): array {
	$input    = is_array( $input ) ? $input : [];
	$existing = all();
	$fields   = fields();
	$clean    = [];

	foreach ( $fields as $key => $config ) {
		$submitted = isset( $input[ $key ] ) ? trim( (string) $input[ $key ] ) : '';
		$is_secret = ! empty( $config['secret'] );

		if ( $is_secret && ( MASK === $submitted || str_starts_with( $submitted, MASK ) ) ) {
			// Unchanged — keep what is already stored.
			$clean[ $key ] = $existing[ $key ] ?? '';
			continue;
		}

		if ( 'select' === ( $config['type'] ?? '' ) ) {
			$allowed       = array_keys( $config['options'] ?? [] );
			$clean[ $key ] = in_array( $submitted, $allowed, true ) ? $submitted : ( $allowed[0] ?? '' );
			continue;
		}

		if ( 'number' === ( $config['type'] ?? '' ) ) {
			$clean[ $key ] = '' === $submitted ? '' : (string) max( 0, (int) $submitted );
			continue;
		}

		if ( 'textarea' === ( $config['type'] ?? '' ) ) {
			$clean[ $key ] = sanitize_textarea_field( $submitted );
			continue;
		}

		$clean[ $key ] = sanitize_text_field( $submitted );
	}

	/*
	 * Prerendered pages only pick the site mode up at build time, so changing
	 * it has to trigger a rebuild or the public site would not change. Fired
	 * only when the mode actually differs, to avoid a deploy on every save.
	 */
	$was = $existing['site_mode'] ?? 'live';
	$now = $clean['site_mode'] ?? 'live';

	if ( $was !== $now ) {
		trigger_rebuild( $now );
	}

	return $clean;
}

/**
 * Ping the deploy hook after a site-mode change.
 *
 * @param string $mode New mode.
 */
function trigger_rebuild( string $mode ): void {
	$hook = defined( 'APP_BUILD_HOOK_URL' ) ? (string) APP_BUILD_HOOK_URL : '';

	if ( '' === $hook ) {
		add_settings_error(
			OPTION,
			'app_no_build_hook',
			__(
				'Site mode saved. No build hook is configured, so already-built pages will not change until the front end is rebuilt.',
				'app'
			),
			'warning'
		);

		return;
	}

	wp_remote_post(
		$hook,
		[
			'timeout'  => 5,
			'blocking' => false,
			'headers'  => [ 'Content-Type' => 'application/json' ],
			'body'     => wp_json_encode( [ 'trigger' => 'app-site-mode', 'mode' => $mode ] ),
		]
	);
}

/**
 * Mask a stored secret for display.
 *
 * @param string $value Stored value.
 * @return string
 */
function masked( string $value ): string {
	if ( '' === $value ) {
		return '';
	}

	return MASK . ( strlen( $value ) > 4 ? ' …' . substr( $value, -4 ) : '' );
}

/* -------------------------------------------------------------------------
 * API access secret
 * ---------------------------------------------------------------------- */

const SECRET_OPTION = 'app_api_secret';

/**
 * Handle the "generate" / "revoke" buttons for the API access secret.
 *
 * Kept out of the Settings API because a secret should be shown exactly once,
 * not round-tripped through a form field on every page load.
 */
function handle_secret_actions(): void {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}

	$action = isset( $_POST['app_secret_action'] ) ? sanitize_key( wp_unslash( $_POST['app_secret_action'] ) ) : '';

	if ( '' === $action ) {
		return;
	}

	check_admin_referer( 'app_secret_action' );

	if ( 'generate' === $action ) {
		// 32 bytes of CSPRNG output, hex encoded — same shape as
		// `openssl rand -hex 32`.
		$secret = bin2hex( random_bytes( 32 ) );
		update_option( SECRET_OPTION, $secret, false );

		// Shown once on the next render, then discarded.
		set_transient( 'app_secret_reveal', $secret, 300 );

		add_settings_error( OPTION, 'app_secret_generated', __( 'New API secret generated.', 'app' ), 'success' );
	}

	if ( 'revoke' === $action ) {
		delete_option( SECRET_OPTION );
		add_settings_error( OPTION, 'app_secret_revoked', __( 'Stored API secret revoked.', 'app' ), 'success' );
	}
}
add_action( 'load-settings_page_app-settings', __NAMESPACE__ . '\\handle_secret_actions' );

/**
 * The API access section of the settings screen.
 */
function render_secret_section(): void {
	$stored     = (string) get_option( SECRET_OPTION, '' );
	$constant   = defined( 'APP_SHARED_SECRET' ) && '' !== trim( (string) APP_SHARED_SECRET );
	$reveal     = get_transient( 'app_secret_reveal' );
	$has_secret = $constant || '' !== $stored;

	if ( is_string( $reveal ) && '' !== $reveal ) {
		delete_transient( 'app_secret_reveal' );
	}
	?>
	<h2><?php esc_html_e( 'API access secret', 'app' ); ?></h2>
	<p class="description">
		<?php
		esc_html_e(
			'The front end sends this as the X-App-Secret header to read users, billing and settings. It is server-to-server only — never expose it to a browser.',
			'app'
		);
		?>
	</p>

	<?php if ( is_string( $reveal ) && '' !== $reveal ) : ?>
		<div class="notice notice-success" style="padding:1rem">
			<p><strong><?php esc_html_e( 'Copy this now — it will not be shown again:', 'app' ); ?></strong></p>
			<p>
				<input type="text" readonly class="large-text code" onclick="this.select()"
					value="<?php echo esc_attr( $reveal ); ?>" />
			</p>
			<p>
				<?php esc_html_e( 'Put it in web/.env as:', 'app' ); ?>
				<code>WP_SHARED_SECRET=<?php echo esc_html( $reveal ); ?></code>
			</p>
			<p class="description">
				<?php
				esc_html_e(
					'Both the old and new secrets work until you revoke the old one, so nothing breaks while you deploy.',
					'app'
				);
				?>
			</p>
		</div>
	<?php endif; ?>

	<table class="form-table" role="presentation">
		<tbody>
			<tr>
				<th scope="row"><?php esc_html_e( 'wp-config constant', 'app' ); ?></th>
				<td>
					<?php if ( $constant ) : ?>
						<span style="color:#1a7f37"><strong><?php esc_html_e( 'Set', 'app' ); ?></strong></span>
						<p class="description">
							<?php esc_html_e( 'APP_SHARED_SECRET is defined. This is the recommended place for it.', 'app' ); ?>
						</p>
					<?php else : ?>
						<span style="color:#888"><?php esc_html_e( 'Not set', 'app' ); ?></span>
					<?php endif; ?>
				</td>
			</tr>
			<tr>
				<th scope="row"><?php esc_html_e( 'Generated secret', 'app' ); ?></th>
				<td>
					<?php if ( '' !== $stored ) : ?>
						<code><?php echo esc_html( '••••••••' . substr( $stored, -6 ) ); ?></code>
					<?php else : ?>
						<span style="color:#888"><?php esc_html_e( 'None', 'app' ); ?></span>
					<?php endif; ?>

					<form method="post" style="margin-top:0.75rem;display:inline-block">
						<?php wp_nonce_field( 'app_secret_action' ); ?>
						<input type="hidden" name="app_secret_action" value="generate" />
						<?php submit_button( __( 'Generate new secret', 'app' ), 'secondary', 'submit', false ); ?>
					</form>

					<?php if ( '' !== $stored ) : ?>
						<form method="post" style="margin-top:0.75rem;display:inline-block">
							<?php wp_nonce_field( 'app_secret_action' ); ?>
							<input type="hidden" name="app_secret_action" value="revoke" />
							<?php submit_button( __( 'Revoke', 'app' ), 'delete', 'submit', false ); ?>
						</form>
					<?php endif; ?>

					<p class="description">
						<?php
						esc_html_e(
							'Both secrets are accepted at once, so you can generate a new one, deploy it, then revoke the old.',
							'app'
						);
						?>
					</p>
				</td>
			</tr>
		</tbody>
	</table>

	<?php if ( ! $has_secret ) : ?>
		<div class="notice notice-error inline" style="margin:1rem 0;padding:0.75rem 1rem">
			<p style="margin:0">
				<?php esc_html_e( 'No secret is configured, so the dashboard cannot sign anyone in and the app API returns 503.', 'app' ); ?>
			</p>
		</div>
	<?php endif; ?>
	<?php
}

/**
 * Render the settings page.
 */
function render_page(): void {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}

	$values = all();
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'App Settings', 'app' ); ?></h1>

		<?php settings_errors( OPTION ); ?>
		<?php render_secret_section(); ?>

		<div class="notice notice-info inline" style="margin:1rem 0;padding:0.75rem 1rem">
			<p style="margin:0">
				<?php
				esc_html_e(
					'Environment variables on the front end always win over anything set here. Env is the safer place for production secrets; this screen is for convenience and for rotating a key without redeploying.',
					'app'
				);
				?>
			</p>
		</div>

		<form method="post" action="options.php">
			<?php settings_fields( 'app_settings_group' ); ?>

			<?php foreach ( schema() as $group_key => $group ) : ?>
				<h2><?php echo esc_html( $group['title'] ); ?></h2>
				<p class="description"><?php echo esc_html( $group['description'] ); ?></p>

				<table class="form-table" role="presentation">
					<tbody>
					<?php foreach ( $group['fields'] as $key => $config ) : ?>
						<?php
						$stored    = (string) ( $values[ $key ] ?? '' );
						$is_secret = ! empty( $config['secret'] );
						$type      = $config['type'] ?? 'text';
						$name      = OPTION . '[' . $key . ']';
						$id        = 'app-' . str_replace( '_', '-', $key );
						?>
						<tr>
							<th scope="row">
								<label for="<?php echo esc_attr( $id ); ?>"><?php echo esc_html( $config['label'] ); ?></label>
							</th>
							<td>
								<?php if ( 'select' === $type ) : ?>
									<select id="<?php echo esc_attr( $id ); ?>" name="<?php echo esc_attr( $name ); ?>">
										<?php foreach ( $config['options'] as $option_value => $option_label ) : ?>
											<option value="<?php echo esc_attr( $option_value ); ?>" <?php selected( $stored, $option_value ); ?>>
												<?php echo esc_html( $option_label ); ?>
											</option>
										<?php endforeach; ?>
									</select>
								<?php elseif ( 'textarea' === $type ) : ?>
									<textarea id="<?php echo esc_attr( $id ); ?>" name="<?php echo esc_attr( $name ); ?>"
										rows="3" class="large-text"><?php echo esc_textarea( $stored ); ?></textarea>
								<?php else : ?>
									<input
										id="<?php echo esc_attr( $id ); ?>"
										name="<?php echo esc_attr( $name ); ?>"
										type="<?php echo 'number' === $type ? 'number' : 'text'; ?>"
										class="regular-text"
										autocomplete="off"
										placeholder="<?php echo esc_attr( $config['placeholder'] ?? '' ); ?>"
										value="<?php echo esc_attr( $is_secret ? masked( $stored ) : $stored ); ?>"
									/>
								<?php endif; ?>

								<?php if ( $is_secret && '' !== $stored ) : ?>
									<p class="description">
										<?php esc_html_e( 'Saved. Leave as-is to keep it; type a new value to replace it.', 'app' ); ?>
									</p>
								<?php endif; ?>

								<?php if ( ! empty( $config['desc'] ) ) : ?>
									<p class="description"><?php echo esc_html( $config['desc'] ); ?></p>
								<?php endif; ?>
							</td>
						</tr>
					<?php endforeach; ?>
					</tbody>
				</table>
			<?php endforeach; ?>

			<?php submit_button(); ?>
		</form>
	</div>
	<?php
}

/**
 * Surface the current site mode prominently — it is easy to forget the site is
 * behind a coming-soon screen.
 */
function mode_notice(): void {
	$mode = get( 'site_mode', 'live' );

	if ( 'live' === $mode || ! current_user_can( 'manage_options' ) ) {
		return;
	}

	printf(
		'<div class="notice notice-warning"><p><strong>%s</strong> %s <a href="%s">%s</a></p></div>',
		esc_html__( 'Front end is not public.', 'app' ),
		esc_html(
			'coming_soon' === $mode
				? __( 'Visitors see the Coming Soon page.', 'app' )
				: __( 'Visitors see the Maintenance page (HTTP 503).', 'app' )
		),
		esc_url( admin_url( 'options-general.php?page=app-settings' ) ),
		esc_html__( 'Change this', 'app' )
	);
}
add_action( 'admin_notices', __NAMESPACE__ . '\\mode_notice' );

/* -------------------------------------------------------------------------
 * REST
 * ---------------------------------------------------------------------- */

/**
 * Expose settings to the Astro server.
 */
function register_routes(): void {
	register_rest_route(
		\App\Auth\NAMESPACE_V1,
		'/settings',
		[
			'methods'             => 'GET',
			'permission_callback' => '\\App\\Auth\\require_shared_secret',
			'callback'            => static function () {
				$values = all();
				$out    = [];

				foreach ( fields() as $key => $config ) {
					$out[ $key ] = (string) ( $values[ $key ] ?? '' );
				}

				return new \WP_REST_Response( [ 'settings' => $out ], 200 );
			},
		]
	);

	/*
	 * Site mode on its own. The front end checks this on every request, so it
	 * is deliberately tiny and does not carry any secrets — that keeps the
	 * hot path cheap and means a cache of it is harmless.
	 */
	register_rest_route(
		\App\Auth\NAMESPACE_V1,
		'/site-mode',
		[
			'methods'             => 'GET',
			'permission_callback' => '\\App\\Auth\\require_shared_secret',
			'callback'            => static function () {
				return new \WP_REST_Response(
					[
						'mode'     => get( 'site_mode', 'live' ),
						'heading'  => get( 'site_mode_heading' ),
						'message'  => get( 'site_mode_message' ),
						'until'    => get( 'site_mode_until' ),
						'allowIps' => array_values(
							array_filter( array_map( 'trim', explode( ',', get( 'site_mode_allow_ips' ) ) ) )
						),
					],
					200
				);
			},
		]
	);
}
add_action( 'rest_api_init', __NAMESPACE__ . '\\register_routes' );

/* -------------------------------------------------------------------------
 * Bridge to the other plugins
 * ---------------------------------------------------------------------- */

/**
 * Let app-emailit.php fall back to the stored key when the constant is absent.
 *
 * @param string $key Key from the constant.
 * @return string
 */
function filter_emailit_key( string $key ): string {
	return '' !== $key ? $key : get( 'emailit_api_key' );
}
add_filter( 'app_emailit_api_key', __NAMESPACE__ . '\\filter_emailit_key' );

/**
 * Same for the From address.
 *
 * @param string $from From address from the constant.
 * @return string
 */
function filter_emailit_from( string $from ): string {
	return '' !== $from ? $from : get( 'emailit_from' );
}
add_filter( 'app_emailit_from', __NAMESPACE__ . '\\filter_emailit_from' );
