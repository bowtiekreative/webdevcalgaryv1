<?php
/**
 * Plugin Name: App — Meta Box → WPGraphQL Bridge
 * Description: Exposes Meta Box (metabox.io) field groups in the WPGraphQL schema.
 * Version:     1.0.0
 *
 * Why this exists instead of a community plugin:
 * there are two well-known bridges (hsimah-services/wp-graphql-metabox and
 * DalkMania/wp-graphql-mb) but both are third-party and have lagged behind
 * WPGraphQL releases in the past. This file is ~400 lines, has no dependencies
 * beyond Meta Box + WPGraphQL themselves, and gives us exact control over how
 * media, groups and post references are shaped for the front end.
 *
 * How it works
 * ------------
 * 1. Field groups are read straight from the `rwmb_meta_boxes` filter, so any
 *    group registered anywhere (including app-fields.php) is picked up.
 * 2. Each group becomes one GraphQL object type, exposed as a single field on
 *    every post type the group is attached to. Querying:
 *
 *      project(id: "brand-refresh", idType: SLUG) {
 *        title
 *        projectDetails {
 *          client
 *          year
 *          deliverables
 *          gallery { url alt width height }
 *        }
 *      }
 *
 * 3. Values are resolved lazily: the group resolver only passes the object ID
 *    down, and each leaf field calls rwmb_meta() only if it was actually asked
 *    for. Nothing is loaded for fields absent from the query.
 *
 * Naming
 * ------
 * Group field name : `graphql_name` on the group, else camelCase of its `id`.
 * Leaf field name  : `graphql_name` on the field, else the field `id` with the
 *                    group's common prefix stripped, camelCased. So the group
 *                    { app_project_client, app_project_year } yields `client`
 *                    and `year` — the shared `app_project_` is inferred.
 * Opt out          : set `'graphql' => false` on a group or a field.
 *
 * @package App
 */

declare( strict_types = 1 );

namespace App\GraphQL\MetaBox;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const MEDIA_TYPE     = 'AppMediaItem';
const POST_REF_TYPE  = 'AppPostRef';
const TYPE_PREFIX    = 'App';

/** Field types whose value is one or more attachments. */
const MEDIA_FIELDS = [
	'single_image'   => 'single',
	'image'          => 'list',
	'image_advanced' => 'list',
	'image_upload'   => 'list',
	'file_advanced'  => 'list',
	'file_upload'    => 'list',
	'video'          => 'list',
];

/** Field types that resolve to a boolean. */
const BOOLEAN_FIELDS = [ 'checkbox', 'switch' ];

/** Field types that reference other posts. */
const POST_FIELDS = [ 'post', 'post_advanced' ];

/** Field types that reference taxonomy terms. */
const TAXONOMY_FIELDS = [ 'taxonomy', 'taxonomy_advanced' ];

/** Field types that resolve to a number. */
const NUMERIC_FIELDS = [ 'number', 'slider', 'range' ];

/**
 * Field types with no meaningful queryable value.
 *
 * `custom_html`, `heading` and friends are presentational only; `divider` and
 * `button` carry no data.
 */
const SKIPPED_FIELDS = [
	'heading',
	'custom_html',
	'divider',
	'button',
	'tab',
	'nonce',
];

/**
 * Object types we have already registered, keyed by type name.
 *
 * A group attached to several post types must only produce one GraphQL type.
 *
 * @var array<string,bool>
 */
$GLOBALS['app_registered_graphql_types'] = [];

/**
 * Entry point.
 */
function register(): void {
	if ( ! function_exists( 'register_graphql_field' ) || ! function_exists( 'rwmb_meta' ) ) {
		// WPGraphQL and/or Meta Box are not active; nothing to do.
		return;
	}

	register_media_type();
	register_post_ref_type();

	foreach ( collect_groups() as $group ) {
		register_group( $group );
	}
}
add_action( 'graphql_register_types', __NAMESPACE__ . '\\register' );

/**
 * Read every registered Meta Box group.
 *
 * Running the filter ourselves gives us the raw, declared config which is
 * stable across Meta Box versions — unlike poking at RW_Meta_Box internals.
 *
 * @return array<int,array>
 */
function collect_groups(): array {
	$groups = apply_filters( 'rwmb_meta_boxes', [] );

	return is_array( $groups ) ? $groups : [];
}

/**
 * Register one Meta Box group as a GraphQL object type on its post types.
 *
 * @param array $group Meta Box group config.
 */
function register_group( array $group ): void {
	if ( isset( $group['graphql'] ) && false === $group['graphql'] ) {
		return;
	}

	$fields = $group['fields'] ?? [];
	$id     = $group['id'] ?? '';

	if ( ! is_array( $fields ) || [] === $fields || '' === $id ) {
		return;
	}

	// Settings pages, term meta and user meta groups are not post-backed; this
	// bridge only handles post types.
	if ( isset( $group['settings_pages'] ) || isset( $group['taxonomies'] ) || ! empty( $group['type'] ) ) {
		return;
	}

	$post_types = normalize_to_array( $group['post_types'] ?? 'post' );

	if ( [] === $post_types ) {
		return;
	}

	$field_name = $group['graphql_name'] ?? camel_case( strip_leading_prefix( $id ) );
	$type_name  = TYPE_PREFIX . pascal_case( $group['graphql_name'] ?? strip_leading_prefix( $id ) );
	$prefix     = derive_common_prefix( $fields );

	$object_type = build_object_type( $type_name, $fields, $prefix );

	if ( null === $object_type ) {
		return;
	}

	foreach ( $post_types as $post_type ) {
		$graphql_type = graphql_type_for_post_type( $post_type );

		if ( null === $graphql_type ) {
			continue;
		}

		register_graphql_field(
			$graphql_type,
			$field_name,
			[
				'type'        => $object_type,
				'description' => sprintf(
					/* translators: %s: field group title. */
					__( 'Meta Box fields from the "%s" group.', 'app' ),
					$group['title'] ?? $id
				),
				'resolve'     => static function ( $source ) {
					$object_id = object_id_from_source( $source );

					// Returning a marker rather than the values themselves is
					// what makes leaf resolution lazy.
					return null === $object_id ? null : [ '__app_object_id' => $object_id ];
				},
			]
		);
	}
}

/**
 * Build (once) and return the GraphQL object type name for a set of fields.
 *
 * @param string $type_name Desired type name.
 * @param array  $fields    Meta Box field configs.
 * @param string $prefix    Common field-id prefix to strip from names.
 * @return string|null Type name, or null if it has no queryable fields.
 */
function build_object_type( string $type_name, array $fields, string $prefix ): ?string {
	$graphql_fields = [];

	foreach ( $fields as $field ) {
		if ( ! is_array( $field ) || empty( $field['id'] ) || empty( $field['type'] ) ) {
			continue;
		}

		if ( isset( $field['graphql'] ) && false === $field['graphql'] ) {
			continue;
		}

		if ( in_array( $field['type'], SKIPPED_FIELDS, true ) ) {
			continue;
		}

		$name = $field['graphql_name'] ?? camel_case( strip_prefix( $field['id'], $prefix ) );

		if ( '' === $name ) {
			continue;
		}

		$type = graphql_type_for_field( $field, $type_name, $name );

		if ( null === $type ) {
			continue;
		}

		$graphql_fields[ $name ] = [
			'type'        => $type,
			'description' => (string) ( $field['desc'] ?? $field['name'] ?? $field['id'] ),
			'resolve'     => static function ( $source ) use ( $field ) {
				return resolve_field( $field, $source );
			},
		];
	}

	if ( [] === $graphql_fields ) {
		return null;
	}

	if ( empty( $GLOBALS['app_registered_graphql_types'][ $type_name ] ) ) {
		register_graphql_object_type(
			$type_name,
			[
				'description' => sprintf(
					/* translators: %s: GraphQL type name. */
					__( 'Meta Box field group: %s', 'app' ),
					$type_name
				),
				'fields'      => $graphql_fields,
			]
		);

		$GLOBALS['app_registered_graphql_types'][ $type_name ] = true;
	}

	return $type_name;
}

/**
 * Map a Meta Box field config to a GraphQL type.
 *
 * @param array  $field       Field config.
 * @param string $parent_type Parent object type name (for nested groups).
 * @param string $field_name  Resolved GraphQL field name.
 * @return string|array|null GraphQL type, or null to skip the field.
 */
function graphql_type_for_field( array $field, string $parent_type, string $field_name ) {
	$type     = (string) $field['type'];
	$is_list  = ! empty( $field['clone'] ) || ! empty( $field['multiple'] );
	$leaf     = null;

	if ( 'group' === $type ) {
		// Requires the MB Group extension; handled generically so it works if
		// you add it later.
		$sub_fields = $field['fields'] ?? [];

		if ( ! is_array( $sub_fields ) || [] === $sub_fields ) {
			return null;
		}

		$leaf = build_object_type(
			$parent_type . pascal_case( $field_name ),
			$sub_fields,
			derive_common_prefix( $sub_fields )
		);

		if ( null === $leaf ) {
			return null;
		}
	} elseif ( array_key_exists( $type, MEDIA_FIELDS ) ) {
		$leaf = MEDIA_TYPE;
		// Media fields are inherently multi-valued except single_image.
		$is_list = 'single' !== MEDIA_FIELDS[ $type ] || $is_list;
	} elseif ( in_array( $type, POST_FIELDS, true ) ) {
		$leaf = POST_REF_TYPE;
	} elseif ( in_array( $type, TAXONOMY_FIELDS, true ) ) {
		$leaf    = 'String';
		$is_list = true;
	} elseif ( in_array( $type, BOOLEAN_FIELDS, true ) ) {
		$leaf = 'Boolean';
	} elseif ( in_array( $type, NUMERIC_FIELDS, true ) ) {
		$leaf = is_integer_field( $field ) ? 'Int' : 'Float';
	} else {
		$leaf = 'String';
	}

	return $is_list ? [ 'list_of' => $leaf ] : $leaf;
}

/**
 * Whether a numeric field should be exposed as Int rather than Float.
 *
 * Meta Box defaults `step` to 1, i.e. integers. Shared by the type declaration
 * and the resolver so the two can never disagree about which one a field is.
 *
 * @param array $field Field config.
 * @return bool
 */
function is_integer_field( array $field ): bool {
	$step = $field['step'] ?? 1;

	return is_numeric( $step ) && floor( (float) $step ) === (float) $step;
}

/**
 * Coerce a raw Meta Box value to a number, or null when it is not set.
 *
 * Meta Box stores an untouched number field as an empty string. Handing that
 * straight to GraphQL makes Int/Float coercion throw, which surfaces as
 * "Internal server error" on the field, so unset values must become null here.
 *
 * @param array $field Field config.
 * @param mixed $raw   Raw value.
 * @return int|float|null
 */
function to_number( array $field, $raw ) {
	if ( is_array( $raw ) || ! is_scalar( $raw ) || '' === trim( (string) $raw ) || ! is_numeric( $raw ) ) {
		return null;
	}

	return is_integer_field( $field ) ? (int) $raw : (float) $raw;
}

/**
 * Resolve a single field's value.
 *
 * Handles both resolution modes: a post-backed group (source carries the object
 * ID) and a nested group value (source is the already-loaded array).
 *
 * @param array $field  Field config.
 * @param mixed $source Parent value.
 * @return mixed
 */
function resolve_field( array $field, $source ) {
	$type    = (string) $field['type'];
	$id      = (string) $field['id'];
	$is_list = ! empty( $field['clone'] ) || ! empty( $field['multiple'] );

	if ( is_array( $source ) && isset( $source['__app_object_id'] ) ) {
		$args = array_key_exists( $type, MEDIA_FIELDS ) ? [ 'size' => 'full' ] : [];
		$raw  = rwmb_meta( $id, $args, (int) $source['__app_object_id'] );
	} elseif ( is_array( $source ) ) {
		$raw = $source[ $id ] ?? null;
	} else {
		return null;
	}

	if ( array_key_exists( $type, MEDIA_FIELDS ) ) {
		$media = normalize_media( $raw );

		return ( 'single' === MEDIA_FIELDS[ $type ] && empty( $field['clone'] ) )
			? ( $media[0] ?? null )
			: $media;
	}

	if ( in_array( $type, POST_FIELDS, true ) ) {
		return normalize_post_ref( $raw, $is_list );
	}

	if ( in_array( $type, BOOLEAN_FIELDS, true ) ) {
		return $is_list ? array_map( 'boolval', normalize_to_array( $raw ) ) : (bool) $raw;
	}

	if ( in_array( $type, TAXONOMY_FIELDS, true ) ) {
		return normalize_terms( $raw );
	}

	if ( in_array( $type, NUMERIC_FIELDS, true ) ) {
		if ( $is_list ) {
			return array_values(
				array_filter(
					array_map(
						static fn( $v ) => to_number( $field, $v ),
						normalize_to_array( $raw )
					),
					static fn( $v ) => null !== $v
				)
			);
		}

		return to_number( $field, $raw );
	}

	if ( 'group' === $type ) {
		if ( ! is_array( $raw ) ) {
			return $is_list ? [] : null;
		}

		// A cloned group is a list of assoc arrays; a single group is one.
		return $is_list ? array_values( array_filter( $raw, 'is_array' ) ) : $raw;
	}

	if ( $is_list ) {
		return array_values(
			array_filter(
				array_map(
					static fn( $v ) => is_scalar( $v ) ? (string) $v : null,
					normalize_to_array( $raw )
				),
				static fn( $v ) => null !== $v && '' !== $v
			)
		);
	}

	// An untouched Meta Box field is stored as an empty string; null is the
	// truthful answer for "not set" and is what the front end normalises to.
	if ( ! is_scalar( $raw ) ) {
		return null;
	}

	$value = (string) $raw;

	return '' === $value ? null : $value;
}

/**
 * Register the shared media object type.
 */
function register_media_type(): void {
	if ( ! empty( $GLOBALS['app_registered_graphql_types'][ MEDIA_TYPE ] ) ) {
		return;
	}

	register_graphql_object_type(
		MEDIA_TYPE,
		[
			'description' => __( 'An attachment selected in a Meta Box media field.', 'app' ),
			'fields'      => [
				'databaseId'  => [ 'type' => 'Int', 'description' => __( 'Attachment post ID.', 'app' ) ],
				'url'         => [ 'type' => 'String', 'description' => __( 'Full-size URL.', 'app' ) ],
				'alt'         => [ 'type' => 'String', 'description' => __( 'Alt text.', 'app' ) ],
				'title'       => [ 'type' => 'String', 'description' => __( 'Attachment title.', 'app' ) ],
				'caption'     => [ 'type' => 'String', 'description' => __( 'Caption.', 'app' ) ],
				'description' => [ 'type' => 'String', 'description' => __( 'Description.', 'app' ) ],
				'width'       => [ 'type' => 'Int', 'description' => __( 'Intrinsic width in pixels.', 'app' ) ],
				'height'      => [ 'type' => 'Int', 'description' => __( 'Intrinsic height in pixels.', 'app' ) ],
				'srcset'      => [ 'type' => 'String', 'description' => __( 'Ready-made srcset attribute.', 'app' ) ],
				'mimeType'    => [ 'type' => 'String', 'description' => __( 'MIME type.', 'app' ) ],
			],
		]
	);

	$GLOBALS['app_registered_graphql_types'][ MEDIA_TYPE ] = true;
}

/**
 * Register the shared post-reference object type.
 */
function register_post_ref_type(): void {
	if ( ! empty( $GLOBALS['app_registered_graphql_types'][ POST_REF_TYPE ] ) ) {
		return;
	}

	register_graphql_object_type(
		POST_REF_TYPE,
		[
			'description' => __( 'A post selected in a Meta Box post field.', 'app' ),
			'fields'      => [
				'databaseId' => [ 'type' => 'Int', 'description' => __( 'Post ID.', 'app' ) ],
				'title'      => [ 'type' => 'String', 'description' => __( 'Post title.', 'app' ) ],
				'slug'       => [ 'type' => 'String', 'description' => __( 'Post slug.', 'app' ) ],
				'uri'        => [ 'type' => 'String', 'description' => __( 'Site-relative permalink.', 'app' ) ],
				'postType'   => [ 'type' => 'String', 'description' => __( 'Post type key.', 'app' ) ],
			],
		]
	);

	$GLOBALS['app_registered_graphql_types'][ POST_REF_TYPE ] = true;
}

/* -------------------------------------------------------------------------
 * Value normalisers
 * ---------------------------------------------------------------------- */

/**
 * Coerce a Meta Box media value into a list of media arrays.
 *
 * @param mixed $raw Raw value.
 * @return array<int,array>
 */
function normalize_media( $raw ): array {
	if ( ! is_array( $raw ) || [] === $raw ) {
		return [];
	}

	// A single_image returns one assoc array; image_advanced returns a map of
	// attachment ID => assoc array.
	$items = isset( $raw['url'] ) || isset( $raw['ID'] ) ? [ $raw ] : $raw;
	$out   = [];

	foreach ( $items as $item ) {
		if ( ! is_array( $item ) ) {
			continue;
		}

		$attachment_id = isset( $item['ID'] ) ? (int) $item['ID'] : 0;

		$out[] = [
			'databaseId'  => $attachment_id ?: null,
			'url'         => $item['full_url'] ?? $item['url'] ?? null,
			'alt'         => $item['alt'] ?? null,
			'title'       => $item['title'] ?? null,
			'caption'     => $item['caption'] ?? null,
			'description' => $item['description'] ?? null,
			'width'       => isset( $item['width'] ) ? (int) $item['width'] : null,
			'height'      => isset( $item['height'] ) ? (int) $item['height'] : null,
			'srcset'      => is_string( $item['srcset'] ?? null ) ? $item['srcset'] : null,
			'mimeType'    => $attachment_id ? ( get_post_mime_type( $attachment_id ) ?: null ) : null,
		];
	}

	return $out;
}

/**
 * Coerce a Meta Box post-field value into post references.
 *
 * @param mixed $raw     Raw value (post ID, WP_Post, or a list of either).
 * @param bool  $is_list Whether the field holds multiple values.
 * @return array|null
 */
function normalize_post_ref( $raw, bool $is_list ) {
	$items = normalize_to_array( $raw );
	$out   = [];

	foreach ( $items as $item ) {
		$post = $item instanceof \WP_Post ? $item : get_post( (int) $item );

		if ( ! $post instanceof \WP_Post ) {
			continue;
		}

		$permalink = get_permalink( $post );

		$out[] = [
			'databaseId' => $post->ID,
			'title'      => get_the_title( $post ),
			'slug'       => $post->post_name,
			'uri'        => is_string( $permalink )
				? ( wp_make_link_relative( $permalink ) ?: null )
				: null,
			'postType'   => $post->post_type,
		];
	}

	return $is_list ? $out : ( $out[0] ?? null );
}

/**
 * Coerce a taxonomy field value into a list of term slugs.
 *
 * @param mixed $raw Raw value.
 * @return array<int,string>
 */
function normalize_terms( $raw ): array {
	$out = [];

	foreach ( normalize_to_array( $raw ) as $term ) {
		if ( $term instanceof \WP_Term ) {
			$out[] = $term->slug;
		} elseif ( is_numeric( $term ) ) {
			$resolved = get_term( (int) $term );
			if ( $resolved instanceof \WP_Term ) {
				$out[] = $resolved->slug;
			}
		} elseif ( is_string( $term ) && '' !== $term ) {
			$out[] = $term;
		}
	}

	return $out;
}

/* -------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------- */

/**
 * Get the object ID out of whatever WPGraphQL handed the resolver.
 *
 * @param mixed $source Resolver source.
 * @return int|null
 */
function object_id_from_source( $source ): ?int {
	if ( is_object( $source ) ) {
		// WPGraphQL\Model\Post exposes both; databaseId is the canonical one.
		$id = $source->databaseId ?? $source->ID ?? null;

		return is_numeric( $id ) ? (int) $id : null;
	}

	if ( is_array( $source ) && isset( $source['__app_object_id'] ) ) {
		return (int) $source['__app_object_id'];
	}

	return is_numeric( $source ) ? (int) $source : null;
}

/**
 * Resolve the GraphQL type name for a post type.
 *
 * @param string $post_type Post type key.
 * @return string|null Null when the post type is not exposed to GraphQL.
 */
function graphql_type_for_post_type( string $post_type ): ?string {
	$object = get_post_type_object( $post_type );

	if ( null === $object ) {
		return null;
	}

	if ( isset( $object->show_in_graphql ) && ! $object->show_in_graphql ) {
		return null;
	}

	$single = $object->graphql_single_name ?? null;

	if ( ! is_string( $single ) || '' === $single ) {
		// Core post types are exposed by WPGraphQL without these properties
		// being set on the object in every version.
		$fallback = [ 'post' => 'Post', 'page' => 'Page', 'attachment' => 'MediaItem' ];

		return $fallback[ $post_type ] ?? null;
	}

	return ucfirst( $single );
}

/**
 * Wrap a value in an array unless it already is one.
 *
 * @param mixed $value Value.
 * @return array
 */
function normalize_to_array( $value ): array {
	if ( is_array( $value ) ) {
		return array_values( $value );
	}

	return ( null === $value || '' === $value ) ? [] : [ $value ];
}

/**
 * Find the longest shared `snake_case` prefix across a group's field IDs.
 *
 * This is what lets `app_project_client` be queried as `client` without any
 * extra configuration. The prefix is always trimmed back to an underscore so a
 * partial word is never chopped, and it is never allowed to consume a field
 * name entirely.
 *
 * @param array $fields Field configs.
 * @return string
 */
function derive_common_prefix( array $fields ): string {
	$ids = [];

	foreach ( $fields as $field ) {
		if ( is_array( $field ) && ! empty( $field['id'] ) && ! in_array( $field['type'] ?? '', SKIPPED_FIELDS, true ) ) {
			$ids[] = (string) $field['id'];
		}
	}

	if ( count( $ids ) < 2 ) {
		// Nothing to compare against; fall back to the project-wide prefix.
		return 'app_';
	}

	$prefix = $ids[0];

	foreach ( array_slice( $ids, 1 ) as $id ) {
		$max = min( strlen( $prefix ), strlen( $id ) );
		$i   = 0;

		while ( $i < $max && $prefix[ $i ] === $id[ $i ] ) {
			$i++;
		}

		$prefix = substr( $prefix, 0, $i );

		if ( '' === $prefix ) {
			return 'app_';
		}
	}

	// Trim back to the last underscore so we never cut mid-word.
	$cut    = strrpos( $prefix, '_' );
	$prefix = false === $cut ? '' : substr( $prefix, 0, $cut + 1 );

	// Guard against a prefix that would empty out one of the field names.
	foreach ( $ids as $id ) {
		if ( '' === trim( strip_prefix( $id, $prefix ), '_' ) ) {
			return 'app_';
		}
	}

	return '' === $prefix ? 'app_' : $prefix;
}

/**
 * Remove a known prefix from a field ID.
 *
 * @param string $id     Field ID.
 * @param string $prefix Prefix.
 * @return string
 */
function strip_prefix( string $id, string $prefix ): string {
	if ( '' !== $prefix && 0 === strpos( $id, $prefix ) ) {
		return substr( $id, strlen( $prefix ) );
	}

	return strip_leading_prefix( $id );
}

/**
 * Remove the project-wide `app_` prefix.
 *
 * @param string $id Identifier.
 * @return string
 */
function strip_leading_prefix( string $id ): string {
	return 0 === strpos( $id, 'app_' ) ? substr( $id, 4 ) : $id;
}

/**
 * snake_case / kebab-case → camelCase.
 *
 * @param string $value Value.
 * @return string
 */
function camel_case( string $value ): string {
	$pascal = pascal_case( $value );

	return '' === $pascal ? '' : lcfirst( $pascal );
}

/**
 * snake_case / kebab-case → PascalCase.
 *
 * @param string $value Value.
 * @return string
 */
function pascal_case( string $value ): string {
	$clean = preg_replace( '/[^a-zA-Z0-9]+/', ' ', $value ) ?? '';
	$parts = preg_split( '/\s+/', trim( $clean ) ) ?: [];
	$out   = '';

	foreach ( $parts as $part ) {
		if ( '' !== $part ) {
			$out .= ucfirst( $part );
		}
	}

	// GraphQL names must not start with a digit. Done with preg rather than
	// ctype_digit() so this carries no extension dependency.
	return 1 === preg_match( '/^[0-9]/', $out ) ? 'F' . $out : $out;
}
