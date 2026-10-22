import type { JobOutput } from '$contract/jobs';
import { LAB_MANUAL_TRIGGER_ID, LAB_TRIGGERS, type LabJobSetup } from './lab-triggers';

export type LabRecipe = Readonly<{
	id: string;
	triggerId: string;
	title: string;
	description: string;
	sentence: string;
}>;

export const LAB_RECIPES: readonly LabRecipe[] = [
	{
		id: 'show-what-shipped',
		triggerId: 'pr-merged',
		title: 'Show what shipped',
		description: 'Record what changed with Grip and post the link to Slack.',
		sentence:
			'When a pull request merges, record what changed with Grip and post the link to Slack',
	},
	{
		id: 'changelog',
		triggerId: 'pr-merged',
		title: 'Changelog on merge',
		description: 'Update CHANGELOG.md and open a draft PR.',
		sentence: 'When a pull request merges, update CHANGELOG.md and open a draft PR',
	},
	{
		id: 'broken-install',
		triggerId: 'install-failed',
		title: 'Fix a broken install',
		description: 'Find out why the install failed and fix it.',
		sentence: 'When the dependency install fails, find out why and fix it',
	},
	{
		id: 'smoke-test',
		triggerId: 'frontend-ready',
		title: 'Smoke-test the frontend',
		description: 'Open it and check the console for errors.',
		sentence: 'When a frontend comes up, open it and check the console for errors',
	},
	{
		id: 'explain-failure',
		triggerId: 'job-failed',
		title: 'Explain a failed job',
		description: 'Read its chat and explain what went wrong.',
		sentence: 'When a job fails, read its chat and explain what went wrong',
	},
	{
		id: 'check-changes',
		triggerId: 'files-changed',
		title: 'Check agent changes',
		description: 'Run lint and the tests near the changed files.',
		sentence: 'When an agent changes files, run lint and the tests near the changed files',
	},
];

const STOP_WORDS = new Set([
	'the',
	'and',
	'for',
	'its',
	'you',
	'your',
	'any',
	'not',
	'are',
	'was',
	'what',
	'when',
	'whenever',
	'that',
	'with',
	'from',
	'into',
	'this',
	'then',
	'them',
	'they',
	'will',
	'while',
	'how',
	'why',
	'out',
	'all',
]);

function stems(text: string): Set<string> {
	const words = text.toLowerCase().match(/[a-z]{3,}/gu) ?? [];
	return new Set(words.filter((word) => !STOP_WORDS.has(word)).map((word) => word.slice(0, 4)));
}

export function labGuessTriggerId(text: string): string {
	const wanted = stems(text);
	let best = { id: LAB_MANUAL_TRIGGER_ID, score: 0 };
	for (const trigger of LAB_TRIGGERS) {
		const label = stems(trigger.label);
		const labelHits = [...label].filter((stem) => wanted.has(stem)).length;
		if (labelHits === 0) continue;
		const detailHits = [...stems(trigger.detail)].filter(
			(stem) => !label.has(stem) && wanted.has(stem),
		).length;
		const score = 2 * labelHits + detailHits;
		if (score > best.score) best = { id: trigger.id, score };
	}
	return best.id;
}

export function labDraftWork(text: string): string {
	const work = text.trim().replace(/^(when|whenever|after|once|if)\b[^,]*,\s*/iu, '');
	return `${work.charAt(0).toUpperCase()}${work.slice(1)}`;
}

const LEAD = /^(when|whenever|after|once|if)\b[^,]*,?\s*/iu;

const OUTPUT_STEPS: readonly Readonly<{ pattern: RegExp; output: JobOutput }>[] = [
	{ pattern: /\b(open|create|make)\s+a\s+draft\s+(pr|pull request)\b/iu, output: 'draft' },
	{ pattern: /\bqueue\s+(the\s+|a\s+)?merge\b/iu, output: 'merge' },
];

const TOOLS = ['Grip', 'Slack', 'Linear', 'Sentry', 'Notion', 'Figma', 'Vercel', 'Discord'];

export type LabDraft = Readonly<{
	name: string;
	lead: string;
	steps: readonly string[];
	output: JobOutput | null;
	tools: readonly string[];
}>;

function capitalized(text: string): string {
	return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

export function labDraft(text: string): LabDraft {
	const trimmed = text.trim();
	const lead = LEAD.exec(trimmed)?.[0]?.trim().replace(/,$/u, '') ?? '';
	const clauses = trimmed
		.slice(LEAD.exec(trimmed)?.[0]?.length ?? 0)
		.split(/\s*(?:,\s*(?:and\s+)?then|,\s*and|\band then|\bthen|\band)\s+/iu)
		.map((clause) => clause.trim().replace(/[.!]+$/u, ''))
		.filter(Boolean);
	const output = OUTPUT_STEPS.find(({ pattern }) => clauses.some((clause) => pattern.test(clause)));
	const steps = clauses
		.filter((clause) => !OUTPUT_STEPS.some(({ pattern }) => pattern.test(clause)))
		.map(capitalized);
	const first = steps[0] ?? 'New job';
	const name = first
		.split(/\s+/u)
		.slice(0, 4)
		.join(' ')
		.replace(/\s+(with|to|in|on|for|and|the|a)$/iu, '');
	return {
		name,
		lead,
		steps,
		output: output?.output ?? null,
		tools: TOOLS.filter((tool) => new RegExp(`\\b${tool}\\b`, 'iu').test(trimmed)),
	};
}

export type LabSavedDraft = Readonly<{
	name: string;
	steps: readonly string[];
	setup: LabJobSetup;
}>;
