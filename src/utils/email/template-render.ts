/**
 * Template rendering for email.
 *
 * This used to call `Handlebars.compile()` at send time. Handlebars compiles by
 * generating JavaScript source and evaluating it with `new Function()`, which
 * Cloudflare Workers refuses outright ("Code generation from strings disallowed
 * for this context") — so every send threw and no email ever left the platform.
 * Templates live in D1 and are editable from the dashboard, so build-time
 * precompilation isn't an option either.
 *
 * Instead we interpret the template directly. No code generation, no
 * dependency, and the supported syntax is the subset the templates actually
 * use:
 *
 *   {{name}}                  — value, HTML-escaped
 *   {{{name}}}                — value, raw (no escaping)
 *   {{user.email}}            — dotted path
 *   {{#if x}}…{{/if}}         — conditional, nestable
 *   {{#if x}}…{{else}}…{{/if}}
 *   {{#unless x}}…{{/unless}}
 *   {{! comment }}            — dropped
 *
 * Escaping, truthiness and missing-value handling match Handlebars: unknown
 * variables render as an empty string, and an empty array is falsy.
 *
 * Any *other* block helper throws rather than silently dropping its body — an
 * operator typo in the dashboard should surface as a recorded send failure, not
 * as a mangled email that looks fine to us and wrong to the recipient.
 */

export interface TemplateInput {
	subject: string;
	html: string;
	text?: string | null;
}

export interface RenderedEmail {
	subject: string;
	html: string;
	text?: string;
}

/** Matches `{{{ raw }}}` first, then `{{ anything }}`. */
const TAG_RE = /\{\{\{([^{}]*)\}\}\}|\{\{([^{}]*)\}\}/g;

/** Same character set Handlebars escapes. */
const ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#x27;",
	"`": "&#x60;",
	"=": "&#x3D;",
};

function escapeHtml(s: string): string {
	return s.replace(/[&<>"'`=]/g, (c) => ESCAPES[c]);
}

/** Resolve a dotted path against the variable bag. Missing → undefined. */
function lookup(vars: Record<string, unknown>, path: string): unknown {
	if (path === "." || path === "this") return vars;
	let cur: unknown = vars;
	for (const key of path.split(".")) {
		if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
		cur = (cur as Record<string, unknown>)[key];
	}
	return cur;
}

/** Handlebars truthiness: an empty array is falsy, unlike plain JS. */
function truthy(v: unknown): boolean {
	if (Array.isArray(v)) return v.length > 0;
	return Boolean(v);
}

function stringify(v: unknown): string {
	if (v === null || v === undefined) return "";
	return String(v);
}

interface Frame {
	/** Emit the body currently being scanned? */
	active: boolean;
	/** Has a branch of this block already matched? (drives `{{else}}`) */
	taken: boolean;
	/** Was the enclosing scope emitting when this block opened? */
	parentOn: boolean;
}

/**
 * Render one template string. `escape` is off for the subject and the plain
 * text body (they aren't markup) and on for HTML, so a variable's value can't
 * break out of the surrounding tags.
 */
export function render(
	template: string,
	vars: Record<string, unknown>,
	escape: boolean,
): string {
	const out: string[] = [];
	const stack: Frame[] = [];
	const emitting = () => stack.every((f) => f.active);

	let cursor = 0;
	let match: RegExpExecArray | null;
	TAG_RE.lastIndex = 0;

	while ((match = TAG_RE.exec(template)) !== null) {
		if (emitting()) out.push(template.slice(cursor, match.index));
		cursor = match.index + match[0].length;

		const isRaw = match[1] !== undefined;
		const inner = (match[1] ?? match[2]).trim();

		if (inner.startsWith("!")) continue; // comment

		if (inner.startsWith("#")) {
			const space = inner.indexOf(" ");
			const helper = (space === -1 ? inner.slice(1) : inner.slice(1, space)).trim();
			const arg = space === -1 ? "" : inner.slice(space + 1).trim();

			if (helper !== "if" && helper !== "unless") {
				throw new Error(
					`Unsupported template helper {{#${helper}}} — only #if and #unless are available.`,
				);
			}

			const parentOn = emitting();
			let value = truthy(lookup(vars, arg));
			if (helper === "unless") value = !value;
			const active = parentOn && value;
			stack.push({ active, taken: active, parentOn });
			continue;
		}

		if (inner === "else") {
			const frame = stack[stack.length - 1];
			// A stray {{else}} outside a block is ignored rather than fatal.
			if (frame) {
				frame.active = frame.parentOn && !frame.taken;
				if (frame.active) frame.taken = true;
			}
			continue;
		}

		if (inner.startsWith("/")) {
			stack.pop(); // tolerate an unbalanced closer
			continue;
		}

		if (!emitting()) continue;
		const text = stringify(lookup(vars, inner));
		out.push(isRaw || !escape ? text : escapeHtml(text));
	}

	if (emitting()) out.push(template.slice(cursor));
	return out.join("");
}

export function renderTemplate(
	tpl: TemplateInput,
	variables: Record<string, unknown>,
): RenderedEmail {
	return {
		subject: render(tpl.subject, variables, false),
		html: render(tpl.html, variables, true),
		text: tpl.text ? render(tpl.text, variables, false) : undefined,
	};
}

/**
 * The public opt-out URL for a subscriber's token. `baseUrl` is the public
 * origin of the site that hosts the unsubscribe page (no trailing slash).
 */
export function buildUnsubscribeUrl(baseUrl: string, token: string): string {
	return `${baseUrl.replace(/\/+$/, "")}/unsubscribe/${encodeURIComponent(token)}`;
}
