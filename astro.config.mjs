import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { d1, r2 } from "@emdash-cms/cloudflare";
import { formsPlugin } from "@emdash-cms/plugin-forms";
import { defineConfig, fontProviders } from "astro/config";
import emdash from "emdash/astro";

export default defineConfig({
	output: "server",
	// `configPath` lets a single codebase build into more than one Worker.
	// The default build (`astro build`) auto-detects `wrangler.jsonc` → the main
	// `curevanails` site. Setting WRANGLER_CONFIG=wrangler.getready.jsonc points
	// the adapter at the standalone config so the build deploys the `getready`
	// Worker (getready.curevanails-tech.workers.dev) instead.
	adapter: cloudflare({ configPath: process.env.WRANGLER_CONFIG }),
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		react(),
		emdash({
			database: d1({ binding: "DB", session: "auto" }),
			storage: r2({ binding: "MEDIA" }),
			plugins: [formsPlugin()],
		}),
	],
	// AWS SNS posts to /api/webhooks/ses with `Content-Type: text/plain` and no
	// `Origin` header. Astro's default CSRF `checkOrigin` rejects exactly that
	// shape with a 403 *before* the handler runs, which silently dropped every
	// SES delivery/bounce/complaint event (so permanent bounces were never
	// suppressed). We turn it off and rely on stronger, intentional protection:
	// the signed-cookie admin gate (src/middleware.ts), SNS signature + topic
	// verification on the webhook, and the unguessable token on /unsubscribe.
	security: { checkOrigin: false },
	fonts: [
		{
			provider: fontProviders.google(),
			name: "Inter",
			cssVariable: "--font-sans",
			weights: [400, 500, 600, 700],
			fallbacks: ["sans-serif"],
		},
		{
			provider: fontProviders.google(),
			name: "JetBrains Mono",
			cssVariable: "--font-mono",
			weights: [400, 500],
			fallbacks: ["monospace"],
		},
	],
	devToolbar: { enabled: false },
});
