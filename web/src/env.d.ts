/// <reference types="astro/client" />

import type { WpUser } from './lib/auth/wp';

declare global {
	namespace App {
		interface Locals {
			/** Set by src/middleware.ts on protected routes. */
			user: WpUser | null;
		}

		interface SessionData {
			/** WordPress user id. Everything else is re-read per request. */
			userId: number;
			/** Anti-CSRF token, issued per session. */
			csrf: string;
		}
	}
}

export {};
