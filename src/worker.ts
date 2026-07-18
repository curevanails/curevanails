import handler from "@astrojs/cloudflare/entrypoints/server";
import { runDueCampaigns } from "./utils/email/campaigns";

export { PluginBridge } from "@emdash-cms/cloudflare/sandbox";

// The Astro Cloudflare adapter provides the `fetch` handler. We extend it with a
// `scheduled` handler so the notify Worker's Cron Trigger (wrangler.notify.jsonc,
// `*/5 * * * *`) can fire due scheduled email campaigns. `ctx.waitUntil` keeps
// the Worker alive until sending finishes. Workers without a cron trigger (the
// main site, getready, admin) never invoke `scheduled`, so this is inert there.
const base = handler as ExportedHandler;

export default {
	fetch: base.fetch,
	scheduled(_controller, _env, ctx) {
		ctx.waitUntil(runDueCampaigns());
	},
} satisfies ExportedHandler;
