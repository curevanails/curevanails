/**
 * A readable plain-text part, derived from the rendered HTML.
 *
 * Every template in the dashboard is HTML-only — nobody writing one in a
 * browser is going to maintain a second copy by hand, and asking them to would
 * only produce two versions that drift. But an HTML-only email is a spam signal
 * (Cloudflare and every deliverability guide say send both), and it is what a
 * screen reader, a watch, and a text-mode client are left with. So the text
 * part is generated at send time from the HTML we are already sending, which
 * means it can never drift from it.
 *
 * This is deliberately not a general-purpose HTML renderer. It handles the
 * markup our templates actually contain — headings, paragraphs, links, lists,
 * tables of label/value rows, inline styling — and aims for "a person can read
 * this and act on it", not for a faithful visual transcription.
 */

/** Elements whose *content* is not text at all. Dropped wholesale. */
const DROPPED = /<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** Elements that end a line. */
const LINE_BREAK = /<br\s*\/?>/gi;

/**
 * Elements that open and close a block. Each becomes a blank line, so
 * paragraphs and headings stay apart once the tags are gone.
 */
const BLOCK =
	/<\/?(p|div|h[1-6]|ul|ol|table|thead|tbody|section|article|header|footer|blockquote|figure|address|hr)\b[^>]*>/gi;

/** A row or a cell ends a line rather than a paragraph — a table reads as lines. */
const ROW = /<\/tr\s*>/gi;
const CELL = /<\/(td|th)\s*>/gi;

/**
 * `<li>` gets a bullet so a list still looks like one. The *opening* tag is
 * what starts the line, so `</li>` is left to the generic strip — breaking on
 * both would put a blank line between every bullet.
 */
const LIST_ITEM = /<li\b[^>]*>/gi;

/** `<img alt="…">` is worth its alt text and nothing else. */
const IMAGE = /<img\b[^>]*?\balt\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi;

/** `<a href="URL">label</a>` — captured so the URL survives the tag strip. */
const LINK = /<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi;

/** Anything else with angle brackets. */
const ANY_TAG = /<\/?[a-z][^>]*>/gi;

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	hellip: "…",
	mdash: "—",
	ndash: "–",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
	bull: "•",
	middot: "·",
	copy: "©",
	reg: "®",
	trade: "™",
	eacute: "é",
	egrave: "è",
	agrave: "à",
};

/**
 * Entities are decoded **after** the tags are stripped, never before: an
 * `&lt;b&gt;` written as content would otherwise turn into a real tag halfway
 * through and be deleted as one.
 */
function decodeEntities(s: string): string {
	return s.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
		if (body[0] === "#") {
			const code =
				body[1] === "x" || body[1] === "X"
					? Number.parseInt(body.slice(2), 16)
					: Number.parseInt(body.slice(1), 10);
			// Surrogates and out-of-range values would throw; leave those as written.
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff
				? String.fromCodePoint(code)
				: whole;
		}
		const named = NAMED_ENTITIES[body.toLowerCase()];
		return named ?? whole;
	});
}

/** The visible label of a link, with its own tags already gone. */
function linkLabel(inner: string): string {
	return decodeEntities(inner.replace(ANY_TAG, "")).replace(/\s+/g, " ").trim();
}

/**
 * How a link reads once there is no anchor to click: `label (url)`, unless the
 * label already *is* the URL (or the address behind a `mailto:`), where
 * repeating it twice is just noise.
 */
function flattenLink(url: string, inner: string): string {
	const href = decodeEntities(url).trim();
	const label = linkLabel(inner);
	if (!href || href.startsWith("#")) return label;
	if (!label) return href;
	const bare = href.replace(/^(mailto|tel):/i, "");
	if (label === href || label === bare) return label;
	return `${label} (${href})`;
}

/**
 * Convert one rendered HTML email into its plain-text counterpart. Runs on
 * every send, so it must never throw: worst case it returns something plain.
 */
export function htmlToText(html: string): string {
	let s = html;

	s = s.replace(DROPPED, " ");
	s = s.replace(LINK, (_m, _q, dq: string | undefined, sq: string | undefined, inner: string) =>
		flattenLink(dq ?? sq ?? "", inner),
	);
	s = s.replace(IMAGE, (_m, _q, dq: string | undefined, sq: string | undefined) => {
		const alt = (dq ?? sq ?? "").trim();
		return alt ? `[${alt}]` : " ";
	});

	s = s.replace(LINE_BREAK, "\n");
	s = s.replace(CELL, "\t");
	s = s.replace(ROW, "\n");
	s = s.replace(LIST_ITEM, "\n- ");
	s = s.replace(BLOCK, "\n\n");
	s = s.replace(ANY_TAG, "");

	s = decodeEntities(s);

	// Whitespace, in one pass over the lines: a tab between table cells becomes
	// a readable separator, runs of spaces collapse, and no line keeps trailing
	// space. Blank lines are capped at one, so the shape of the email survives
	// without the gaps the markup left behind.
	s = s
		.split("\n")
		.map((line) =>
			line
				.replace(/\t+/g, ": ")
				.replace(/[^\S\n]+/g, " ")
				.replace(/ +: /g, ": ")
				.replace(/(: )+$/, "")
				.trim(),
		)
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	return s;
}
