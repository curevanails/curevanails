import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { d1, r2 } from "@emdash-cms/cloudflare";
import { formsPlugin } from "@emdash-cms/plugin-forms";
import { defineConfig, fontProviders } from "astro/config";
import emdash from "emdash/astro";

export default defineConfig({
	output: "server",
	// The canonical origin. Without it `Astro.site` is undefined and every
	// canonical link, og:url and sitemap entry would have to be relative —
	// which search engines treat as a different page per host, and which
	// makes the three Workers (curevanails / getready / admin) look like
	// three copies of the same site.
	site: "https://curevanails.com",
	// `configPath` lets a single codebase build into more than one Worker.
	// The default build (`astro build`) auto-detects `wrangler.jsonc` → the main
	// `curevanails` site. Setting WRANGLER_CONFIG=wrangler.getready.jsonc points
	// the adapter at the standalone config so the build deploys the `getready`
	// Worker (getready.curevanails-tech.workers.dev) instead.
	adapter: cloudflare({ configPath: process.env.WRANGLER_CONFIG }),
	// AWS SDK v3 picks its Node/browser flavour two different ways: `@aws-sdk/core`
	// swaps via modern `exports` conditions (Vite honours it → browser build),
	// while `@aws-sdk/client-sesv2` swaps `runtimeConfig` via the legacy top-level
	// `browser` field, which Vite ignores in SSR. The halves then disagree:
	// client-sesv2 bundles the Node `runtimeConfig`, which calls
	// `emitWarningIfUnsupportedVersion(process.version)` — a symbol the browser
	// build of `@aws-sdk/core` exports as `Symbol.for("node-only")`, not a
	// function. Every SES client construction died with
	// "emitWarningIfUnsupportedVersion is not a function", so no email ever sent.
	// This alias is AWS's documented Vite fix: force the browser runtimeConfig so
	// both halves agree.
	vite: {
		resolve: {
			alias: [{ find: /^\.\/runtimeConfig$/, replacement: "./runtimeConfig.browser" }],
		},
	},
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
	// No `fonts:` block. The site runs on version H, whose two families —
	// Fraunces and Manrope — come from the ONE Google Fonts <link> that every
	// layout carries, and which is the only external request the design system
	// makes. Astro's font pipeline was serving Inter + JetBrains Mono for the
	// old blog theme; nothing imports `astro:assets`' <Font> any more, so the
	// block only cost 20 copied files a build. See design/version-h/README.md §1.2.
	devToolbar: { enabled: false },
});
