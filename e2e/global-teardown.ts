import { execSync } from "node:child_process";
import { E2E_SURNAME } from "./helpers";

/**
 * Remove the rows the real-API happy-path tests insert into the local D1.
 *
 * Rows are matched on `last_name` rather than the email prefix: email is
 * optional on the Hiring Form and one test deliberately omits it, so an
 * email-only filter would leak rows into the local admin dashboard.
 *
 * Local-only state; best-effort, never fails the run. CI's D1 is ephemeral, so
 * this is a no-op there.
 */
export default function globalTeardown(): void {
	try {
		execSync(
			`npx wrangler d1 execute curevanails --local --command "DELETE FROM job_applications WHERE last_name = '${E2E_SURNAME}'"`,
			{ stdio: "ignore" },
		);
	} catch {
		// Table may not exist yet, or wrangler unavailable — ignore.
	}
}
