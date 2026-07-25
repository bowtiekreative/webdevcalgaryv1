/**
 * GraphQL documents for every collection the site builds from.
 *
 * Field names here must match the schema produced by the mu-plugins in
 * ../../../../wordpress/mu-plugins. In particular the Meta Box groups are
 * exposed as one object field per group (`projectDetails`, `seo`, `hero`, …) by
 * btk-graphql-metabox.php, and `frontendPath` comes from btk-headless.php.
 *
 * Check anything you change against GraphiQL:
 *   http://localhost:8080/wp-admin/admin.php?page=graphiql-ide
 */

/** Our BtkMediaItem object type, produced by any Meta Box media field. */
const MEDIA_FRAGMENT = /* GraphQL */ `
	fragment MediaFields on BtkMediaItem {
		databaseId
		url
		alt
		title
		caption
		width
		height
		srcset
		mimeType
	}
`;

/** WordPress's own featured image, which is a MediaItem rather than ours. */
const FEATURED_IMAGE_FRAGMENT = /* GraphQL */ `
	fragment FeaturedImage on NodeWithFeaturedImage {
		featuredImage {
			node {
				sourceUrl
				altText
				title
				mediaDetails {
					width
					height
				}
			}
		}
	}
`;

const SEO_FRAGMENT = /* GraphQL */ `
	fragment SeoFields on BtkSeo {
		title
		description
		noindex
		image {
			...MediaFields
		}
	}
`;

const PAGE_INFO = /* GraphQL */ `
	pageInfo {
		hasNextPage
		endCursor
	}
`;

export const PAGES_QUERY = /* GraphQL */ `
	${MEDIA_FRAGMENT}
	${FEATURED_IMAGE_FRAGMENT}
	${SEO_FRAGMENT}

	query Pages($first: Int!, $after: String) {
		pages(first: $first, after: $after) {
			${PAGE_INFO}
			nodes {
				databaseId
				slug
				uri
				title
				content
				date
				modified
				frontendPath
				isFrontPage
				parent {
					node {
						... on Page {
							slug
						}
					}
				}
				...FeaturedImage
				seo {
					...SeoFields
				}
				hero {
					eyebrow
					heading
					subheading
					ctaLabel
					ctaUrl
					image {
						...MediaFields
					}
				}
			}
		}
	}
`;

export const POSTS_QUERY = /* GraphQL */ `
	${MEDIA_FRAGMENT}
	${FEATURED_IMAGE_FRAGMENT}
	${SEO_FRAGMENT}

	query Posts($first: Int!, $after: String) {
		posts(first: $first, after: $after) {
			${PAGE_INFO}
			nodes {
				databaseId
				slug
				uri
				title
				content
				excerpt
				date
				modified
				frontendPath
				author {
					node {
						name
						slug
					}
				}
				categories {
					nodes {
						name
						slug
					}
				}
				tags {
					nodes {
						name
						slug
					}
				}
				...FeaturedImage
				seo {
					...SeoFields
				}
			}
		}
	}
`;

export const PROJECTS_QUERY = /* GraphQL */ `
	${MEDIA_FRAGMENT}
	${FEATURED_IMAGE_FRAGMENT}
	${SEO_FRAGMENT}

	query Projects($first: Int!, $after: String) {
		projects(first: $first, after: $after) {
			${PAGE_INFO}
			nodes {
				databaseId
				slug
				uri
				title
				content
				excerpt
				date
				modified
				menuOrder
				frontendPath
				capabilities {
					nodes {
						name
						slug
					}
				}
				industries {
					nodes {
						name
						slug
					}
				}
				...FeaturedImage
				seo {
					...SeoFields
				}
				projectDetails {
					client
					year
					role
					summary
					deliverables
					url
					featured
					hero {
						...MediaFields
					}
					gallery {
						...MediaFields
					}
				}
			}
		}
	}
`;

export const SERVICES_QUERY = /* GraphQL */ `
	${MEDIA_FRAGMENT}
	${FEATURED_IMAGE_FRAGMENT}
	${SEO_FRAGMENT}

	query Services($first: Int!, $after: String) {
		services(first: $first, after: $after) {
			${PAGE_INFO}
			nodes {
				databaseId
				slug
				uri
				title
				content
				excerpt
				date
				modified
				menuOrder
				frontendPath
				capabilities {
					nodes {
						name
						slug
					}
				}
				...FeaturedImage
				seo {
					...SeoFields
				}
				serviceDetails {
					tagline
					icon
					bullets
					startingPrice
				}
			}
		}
	}
`;

export const TESTIMONIALS_QUERY = /* GraphQL */ `
	${MEDIA_FRAGMENT}

	query Testimonials($first: Int!, $after: String) {
		testimonials(first: $first, after: $after) {
			${PAGE_INFO}
			nodes {
				databaseId
				slug
				title
				content
				date
				modified
				menuOrder
				testimonialDetails {
					quote
					author
					role
					company
					rating
					photo {
						...MediaFields
					}
					project {
						databaseId
						title
						slug
						uri
						postType
					}
				}
			}
		}
	}
`;

/** Site-wide values from WordPress's own settings. */
export const SITE_QUERY = /* GraphQL */ `
	query SiteMeta {
		generalSettings {
			title
			description
			url
		}
	}
`;

/**
 * Primary navigation, if a menu is assigned to a location named PRIMARY.
 *
 * Kept separate so a site with no menus configured still builds — the caller
 * treats a failure here as "no menu".
 */
export const MENU_QUERY = /* GraphQL */ `
	query PrimaryMenu {
		menuItems(where: { location: PRIMARY }, first: 50) {
			nodes {
				id
				label
				uri
				url
				target
				parentId
			}
		}
	}
`;
