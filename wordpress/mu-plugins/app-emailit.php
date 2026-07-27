<?php
/**
 * Plugin Name: App — Emailit Delivery
 * Description: Routes WordPress's own mail through Emailit instead of PHP mail().
 * Version:     1.0.0
 *
 * Password resets and new-user notifications are the emails that matter most in
 * a headless setup, and they are exactly the ones PHP mail() drops silently
 * from a container with no MTA. This overrides wp_mail() to POST to Emailit.
 *
 * The marketing side (audiences, campaigns) lives in the Astro dashboard —
 * this is only transactional delivery for WordPress-generated mail.
 *
 * Configure in wp-config.php (docker-compose.yml sets these from .env):
 *   APP_EMAILIT_API_KEY   required, else wp_mail falls back to the default
 *   APP_EMAILIT_FROM      e.g. "Studio <hello@yourdomain.com>"
 *
 * @package App
 */

declare( strict_types = 1 );

namespace App\Emailit;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const API_BASE = 'https://api.emailit.com/v2';

/**
 * API key, or empty when Emailit is not configured.
 *
 * @return string
 */
function api_key(): string {
	$key = defined( 'APP_EMAILIT_API_KEY' ) ? trim( (string) APP_EMAILIT_API_KEY ) : '';

	/**
	 * Filter the Emailit API key.
	 *
	 * app-settings.php hooks this so a key entered in wp-admin is used when the
	 * wp-config constant is absent. The constant always wins.
	 *
	 * @param string $key Key from the constant, possibly empty.
	 */
	return (string) apply_filters( 'app_emailit_api_key', $key );
}

/**
 * Default From address.
 *
 * @return string
 */
function from_address(): string {
	$configured = defined( 'APP_EMAILIT_FROM' ) ? trim( (string) APP_EMAILIT_FROM ) : '';

	/** @see api_key() — same constant-wins-over-admin precedence. */
	$configured = (string) apply_filters( 'app_emailit_from', $configured );

	if ( '' !== $configured ) {
		return $configured;
	}

	// Same shape as WordPress's own default, minus the "wordpress@" local part
	// which most providers reject as a spoof.
	$host = wp_parse_url( home_url(), PHP_URL_HOST );

	return 'no-reply@' . ( is_string( $host ) ? ltrim( $host, 'www.' ) : 'example.com' );
}

/**
 * Normalise wp_mail's very forgiving $to into a list of addresses.
 *
 * @param string|array $to Recipient(s).
 * @return array<int,string>
 */
function normalize_recipients( $to ): array {
	$list = is_array( $to ) ? $to : explode( ',', (string) $to );
	$out  = [];

	foreach ( $list as $address ) {
		$address = trim( (string) $address );

		// "Name <a@b.c>" -> a@b.c
		if ( preg_match( '/<([^>]+)>/', $address, $matches ) ) {
			$address = trim( $matches[1] );
		}

		if ( '' !== $address && is_email( $address ) ) {
			$out[] = $address;
		}
	}

	return array_values( array_unique( $out ) );
}

/**
 * Pull a header value out of wp_mail's headers argument.
 *
 * @param string|array $headers Headers.
 * @param string       $name    Header name, lowercase.
 * @return string
 */
function header_value( $headers, string $name ): string {
	$list = is_array( $headers ) ? $headers : preg_split( "/\r\n|\n|\r/", (string) $headers );

	foreach ( (array) $list as $header ) {
		$header = (string) $header;

		if ( false === strpos( $header, ':' ) ) {
			continue;
		}

		[ $key, $value ] = explode( ':', $header, 2 );

		if ( strtolower( trim( $key ) ) === $name ) {
			return trim( $value );
		}
	}

	return '';
}

/**
 * Send one message through Emailit.
 *
 * @param array $args wp_mail arguments.
 * @return bool
 */
function send( array $args ): bool {
	$key = api_key();

	if ( '' === $key ) {
		return false;
	}

	$recipients = normalize_recipients( $args['to'] ?? '' );

	if ( [] === $recipients ) {
		return false;
	}

	$headers      = $args['headers'] ?? '';
	$content_type = strtolower( header_value( $headers, 'content-type' ) );
	$is_html      = false !== strpos( $content_type, 'text/html' );
	$message      = (string) ( $args['message'] ?? '' );

	$body = [
		'from'    => header_value( $headers, 'from' ) ?: from_address(),
		'to'      => implode( ',', $recipients ),
		'subject' => (string) ( $args['subject'] ?? '' ),
	];

	// WordPress sends plain text unless a content-type header says otherwise.
	if ( $is_html ) {
		$body['html'] = $message;
	} else {
		$body['text'] = $message;
	}

	$reply_to = header_value( $headers, 'reply-to' );

	if ( '' !== $reply_to ) {
		$body['reply_to'] = $reply_to;
	}

	$response = wp_remote_post(
		API_BASE . '/emails/send',
		[
			'timeout' => 15,
			'headers' => [
				'Authorization' => 'Bearer ' . $key,
				'Content-Type'  => 'application/json',
				'Accept'        => 'application/json',
			],
			'body'    => wp_json_encode( $body ),
		]
	);

	if ( is_wp_error( $response ) ) {
		error_log( '[app-emailit] transport error: ' . $response->get_error_message() );

		return false;
	}

	$status = (int) wp_remote_retrieve_response_code( $response );

	if ( $status < 200 || $status >= 300 ) {
		error_log(
			sprintf(
				'[app-emailit] send failed (%d): %s',
				$status,
				substr( (string) wp_remote_retrieve_body( $response ), 0, 300 )
			)
		);

		return false;
	}

	return true;
}

/**
 * Short-circuit wp_mail.
 *
 * Returning a non-null value from this filter makes WordPress skip PHPMailer
 * entirely and use what we return as wp_mail's result.
 *
 * Returning null (rather than false) when Emailit is unconfigured lets
 * WordPress fall through to its normal delivery, so a missing API key degrades
 * to the default behaviour instead of breaking all mail.
 *
 * @param null|bool $short_circuit Whatever a previous filter decided.
 * @param array     $args          wp_mail arguments.
 * @return null|bool
 */
function pre_wp_mail( $short_circuit, $args ) {
	if ( null !== $short_circuit ) {
		return $short_circuit;
	}

	if ( '' === api_key() ) {
		return null;
	}

	return send( is_array( $args ) ? $args : [] );
}
add_filter( 'pre_wp_mail', __NAMESPACE__ . '\\pre_wp_mail', 10, 2 );

/**
 * Tell the admin when mail is going nowhere.
 */
function delivery_notice(): void {
	if ( ! current_user_can( 'manage_options' ) || '' !== api_key() ) {
		return;
	}

	printf(
		'<div class="notice notice-info is-dismissible"><p>%s</p></div>',
		esc_html__(
			'APP_EMAILIT_API_KEY is not set, so WordPress is using default mail delivery — which usually fails silently in Docker. Password reset emails will not arrive until it is configured.',
			'app'
		)
	);
}
add_action( 'admin_notices', __NAMESPACE__ . '\\delivery_notice' );
