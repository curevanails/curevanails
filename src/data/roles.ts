/**
 * The open roles — one source, three readers.
 *
 * The copy used to live inside RoleAccordion.astro, which was fine while
 * the accordion was the only thing that knew about it. /recruit/apply now
 * opens with a count of how many positions are open, and a hard-coded "6"
 * beside a list that says 2 + 2 + 1 + 1 is a number that goes wrong the
 * first time somebody fills a role. TOTAL_OPENINGS is derived, so the
 * headline cannot drift from the list under it.
 *
 * Read by: components/vh/RoleAccordion.astro, pages/recruit/apply.astro,
 * and the JobPosting structured data on pages/recruit.astro.
 */
export interface Role {
	title: string;
	/** How many of this role are open. Drives the count and the meta line. */
	openings: number;
	employment: string;
	body: string;
	points: string[];
}

export const ROLES: Role[] = [
	{
		title: "Nail Technician",
		openings: 2,
		employment: "Full-time / Part-time",
		body: "We're looking for someone who takes pride in their work, enjoys creating meaningful connections with clients, and wants to grow with a team that's redefining the salon experience.",
		points: [
			"Licensed (or eligible for Utah licensure)",
			"Kind, dependable, and detail-oriented",
			"Excited to learn and grow with us",
		],
	},
	{
		title: "Esthetician",
		openings: 2,
		employment: "Full-time / Part-time",
		body: "We're looking for someone who genuinely enjoys helping others feel confident, values a calm and welcoming environment, and wants to be part of building something special from the beginning.",
		points: [
			"Licensed (or eligible for Utah licensure)",
			"Warm, caring, and professional",
			"Passionate about continuous learning",
		],
	},
	{
		title: "Lash & Brow Specialist",
		openings: 1,
		employment: "Full-time / Part-time",
		body: "We're looking for someone who appreciates natural beauty, pays attention to the little details, and enjoys building lasting relationships with every client.",
		points: [
			"Licensed (or eligible for Utah licensure)",
			"Patient, reliable, and detail-oriented",
			"Committed to delivering a thoughtful experience",
		],
	},
	{
		title: "Cosmetologist",
		openings: 1,
		employment: "Full-time / Part-time",
		body: "We're looking for someone who enjoys working with people, embraces learning new techniques, and wants to help shape the culture of a growing wellness-focused studio.",
		points: [
			"Licensed (or eligible for Utah licensure)",
			"Positive, adaptable, and team-oriented",
			"Interested in growing with CURE VÀ",
		],
	},
];

/** Positions open, not distinct roles — 2 + 2 + 1 + 1, currently six. */
export const TOTAL_OPENINGS = ROLES.reduce((n, r) => n + r.openings, 0);

/** "2 openings · Full-time / Part-time" — pluralised from the count. */
export function roleMeta(role: Role): string {
	return `${role.openings} opening${role.openings === 1 ? "" : "s"} · ${role.employment}`;
}
