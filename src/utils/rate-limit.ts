/**
 * Lightweight KV-backed rate limiter for public endpoints.
 *
 * Uses the existing `SESSION` KV namespace (bound on every Worker) — a
 * fixed-window counter keyed by client IP. Good enough to blunt form abuse on
 * the public waitlist endpoint without adding another binding. If KV is
 * unavailable the limiter fails open (returns allowed) so a KV hiccup never
 * blocks a legitimate signup.
 *
 * Note: KV's minimum TTL is 60s, so `windowSec` must be ≥ 60.
 */

export interface RateLimitResult {
	ok: boolean;
	remaining: number;
}

export async function rateLimit(
	kv: KVNamespace | undefined,
	key: string,
	limit: number,
	windowSec: number,
): Promise<RateLimitResult> {
	if (!kv) return { ok: true, remaining: limit };

	const k = `rl:${key}`;
	const now = Date.now();

	try {
		const cur = (await kv.get(k, "json")) as { c: number; reset: number } | null;

		if (!cur || cur.reset < now) {
			await kv.put(k, JSON.stringify({ c: 1, reset: now + windowSec * 1000 }), {
				expirationTtl: windowSec,
			});
			return { ok: true, remaining: limit - 1 };
		}

		if (cur.c >= limit) return { ok: false, remaining: 0 };

		const ttl = Math.max(60, Math.ceil((cur.reset - now) / 1000));
		await kv.put(k, JSON.stringify({ c: cur.c + 1, reset: cur.reset }), {
			expirationTtl: ttl,
		});
		return { ok: true, remaining: limit - cur.c - 1 };
	} catch {
		return { ok: true, remaining: limit };
	}
}
