/**
 * Minimal WPGraphQL client.
 *
 * Deliberately dependency-free: WPGraphQL speaks plain HTTP POST with a JSON
 * body, so a `graphql` runtime dependency would buy us nothing at build time.
 *
 * Environment (see web/.env.example):
 *   WP_GRAPHQL_ENDPOINT      required — e.g. http://localhost:8080/graphql
 *   WP_APPLICATION_PASSWORD  optional — "user:application password", enables
 *                            querying drafts/private fields
 *   WP_REQUEST_TIMEOUT_MS    optional — per-attempt timeout, default 20000
 *   WP_FAIL_ON_ERROR         optional — "1" to fail the build when WordPress is
 *                            unreachable instead of warning and continuing
 */

export interface GraphQLErrorShape {
	message: string;
	path?: Array<string | number>;
	locations?: Array<{ line: number; column: number }>;
	extensions?: Record<string, unknown>;
}

interface GraphQLResponse<T> {
	data?: T | null;
	errors?: GraphQLErrorShape[];
}

/**
 * Thrown for transport failures and for GraphQL `errors` in the response.
 *
 * The GraphQL errors are exposed as `graphqlErrors`, deliberately *not* as
 * `errors`: Astro's error reporter treats any thrown object with an `errors`
 * array as an aggregate error and reports its contents instead of the error
 * itself, so an empty array made real build failures surface as
 * "Cannot read properties of undefined (reading 'name')".
 */
export class WpGraphQLError extends Error {
	readonly graphqlErrors: GraphQLErrorShape[];
	readonly status?: number;

	constructor(
		message: string,
		options: { graphqlErrors?: GraphQLErrorShape[]; status?: number; cause?: unknown } = {},
	) {
		super(message, { cause: options.cause });
		this.name = 'WpGraphQLError';
		this.graphqlErrors = options.graphqlErrors ?? [];
		this.status = options.status;
	}
}

function env(key: string): string | undefined {
	// import.meta.env carries values from .env for server-side code; process.env
	// covers CI and shell-provided values.
	const fromVite = (import.meta.env as Record<string, string | undefined>)[key];
	const fromNode = typeof process !== 'undefined' ? process.env?.[key] : undefined;
	const value = fromVite ?? fromNode;

	return value === undefined || value === '' ? undefined : value;
}

export function getEndpoint(): string {
	const endpoint = env('WP_GRAPHQL_ENDPOINT');

	if (!endpoint) {
		throw new WpGraphQLError(
			'WP_GRAPHQL_ENDPOINT is not set. Copy web/.env.example to web/.env and point it at your WordPress /graphql endpoint.',
		);
	}

	return endpoint;
}

/** Whether a build should hard-fail when WordPress cannot be reached. */
export function failOnError(): boolean {
	return env('WP_FAIL_ON_ERROR') === '1' || env('WP_FAIL_ON_ERROR') === 'true';
}

function authHeader(): Record<string, string> {
	const credentials = env('WP_APPLICATION_PASSWORD');

	if (!credentials || !credentials.includes(':')) {
		return {};
	}

	// WordPress application passwords are sent as HTTP Basic credentials.
	return { Authorization: `Basic ${Buffer.from(credentials, 'utf8').toString('base64')}` };
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface QueryOptions {
	/** Number of attempts on transport/5xx failures. Default 3. */
	attempts?: number;
	/** Label used in error messages, to make build logs readable. */
	label?: string;
	signal?: AbortSignal;
}

/**
 * Execute a GraphQL query and return `data`.
 *
 * Throws {@link WpGraphQLError} on transport failure or when the response
 * carries GraphQL errors.
 */
export async function wpQuery<T = unknown>(
	query: string,
	variables: Record<string, unknown> = {},
	options: QueryOptions = {},
): Promise<T> {
	const endpoint = getEndpoint();
	const attempts = Math.max(1, options.attempts ?? 3);
	const label = options.label ?? 'query';
	const timeoutMs = Number(env('WP_REQUEST_TIMEOUT_MS') ?? 20_000);

	let lastError: unknown;

	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json',
					...authHeader(),
				},
				body: JSON.stringify({ query, variables }),
				signal: options.signal ?? AbortSignal.timeout(timeoutMs),
			});

			if (!response.ok) {
				const body = await response.text().catch(() => '');
				const error = new WpGraphQLError(
					`WordPress returned ${response.status} ${response.statusText} for ${label}${body ? `: ${body.slice(0, 300)}` : ''}`,
					{ status: response.status },
				);

				if (RETRYABLE_STATUS.has(response.status) && attempt < attempts) {
					lastError = error;
					await backoff(attempt);
					continue;
				}

				throw error;
			}

			const payload = (await response.json()) as GraphQLResponse<T>;

			if (payload.errors?.length) {
				// WPGraphQL returns partial data alongside errors for nullable
				// fields. Surfacing them is almost always what you want at build
				// time — a silently-missing field is far more expensive to debug.
				throw new WpGraphQLError(
					`GraphQL errors in ${label}: ${payload.errors.map((e) => e.message).join('; ')}`,
					{ graphqlErrors: payload.errors },
				);
			}

			if (payload.data === undefined || payload.data === null) {
				throw new WpGraphQLError(`GraphQL response for ${label} contained no data.`);
			}

			return payload.data;
		} catch (error) {
			// GraphQL-level errors are deterministic; retrying cannot help.
			if (error instanceof WpGraphQLError && error.graphqlErrors.length > 0) {
				throw error;
			}

			lastError = error;

			if (attempt >= attempts) {
				break;
			}

			await backoff(attempt);
		}
	}

	if (lastError instanceof WpGraphQLError) {
		throw lastError;
	}

	throw new WpGraphQLError(
		`Could not reach WordPress at ${endpoint} for ${label} after ${attempts} attempts.`,
		{ cause: lastError },
	);
}

function backoff(attempt: number): Promise<void> {
	const delay = Math.min(2_000, 250 * 2 ** (attempt - 1));

	return new Promise((resolve) => setTimeout(resolve, delay));
}

export interface PageInfo {
	hasNextPage: boolean;
	endCursor: string | null;
}

export interface Connection<T> {
	nodes: T[];
	pageInfo: PageInfo;
}

/**
 * Follow a WPGraphQL cursor connection to the end and return every node.
 *
 * WPGraphQL caps `first` at 100 per request, so anything that can grow past
 * that must paginate.
 */
export async function wpQueryAll<T>(
	query: string,
	select: (data: never) => Connection<T> | null | undefined,
	options: QueryOptions & { pageSize?: number; variables?: Record<string, unknown> } = {},
): Promise<T[]> {
	const pageSize = Math.min(100, options.pageSize ?? 100);
	const nodes: T[] = [];
	let after: string | null = null;
	// Hard stop so a server that always reports hasNextPage cannot hang a build.
	const maxPages = 200;

	for (let page = 0; page < maxPages; page++) {
		const data = await wpQuery<never>(
			query,
			{ ...options.variables, first: pageSize, after },
			options,
		);

		const connection = select(data);

		if (!connection) {
			break;
		}

		nodes.push(...(connection.nodes ?? []));

		if (!connection.pageInfo?.hasNextPage || !connection.pageInfo.endCursor) {
			break;
		}

		after = connection.pageInfo.endCursor;
	}

	return nodes;
}
