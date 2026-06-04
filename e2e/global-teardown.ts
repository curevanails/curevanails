import { execSync } from "node:child_process";

/**
 * Remove the rows the real-API happy-path tests insert into the local D1
 * (emails are prefixed `e2e+`). Local-only state; best-effort, never fails the
 * run. CI's D1 is ephemeral, so this is a no-op there.
 */
export default function globalTeardown(): void {
	try {
		execSync(
			`npx wrangler d1 execute curevanails --local --command "DELETE FROM job_applications WHERE email LIKE 'e2e+%@example.com'"`,
			{ stdio: "ignore" },
		);
	} catch {
		// Table may not exist yet, or wrangler unavailable — ignore.
	}
}
