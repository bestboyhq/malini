import type { AutomaticJobBuiltin } from '$contract/jobs';

// ponytail: a fixed verb list misses verbs it does not name; let a job declare its own checks when one needs more
const NAME_VERBS = new Set([
	'add',
	'adding',
	'building',
	'changing',
	'checking',
	'choosing',
	'cleaning',
	'comparing',
	'create',
	'creating',
	'debugging',
	'deleting',
	'deploying',
	'designing',
	'exploring',
	'finding',
	'fix',
	'fixing',
	'getting',
	'handling',
	'help',
	'helping',
	'implement',
	'implementing',
	'improve',
	'improving',
	'installing',
	'investigate',
	'investigating',
	'make',
	'making',
	'migrating',
	'moving',
	'planning',
	'refactoring',
	'remove',
	'removing',
	'renaming',
	'restore',
	'restoring',
	'reviewing',
	'running',
	'setting',
	'shipping',
	'testing',
	'update',
	'updating',
	'using',
	'writing',
]);

const SERVICE_VERBS = new Set(['launch', 'open', 'restart', 'run', 'serve', 'start', 'watch']);

const SERVICE_TOOLS = new Set([
	'bun',
	'deno',
	'node',
	'npm',
	'npx',
	'pnpm',
	'python',
	'vite',
	'wrangler',
	'yarn',
]);

const TRAILING_PUNCTUATION = /[.!?,;:]$/u;
const QUOTES = /["“”`]/u;
const TASK_PREFIX = /^task:\s*/iu;

export const JOB_OUTPUT_FAILED = 'No name';

export function jobOutputIssues(
	builtin: AutomaticJobBuiltin,
	output: string | null,
): readonly string[] {
	const text = output?.trim() ?? '';
	if (text.length === 0) return [JOB_OUTPUT_FAILED];
	return builtin === 'name-chats' ? chatNameIssues(text) : serviceNameIssues(text);
}

export function followsEveryRule(builtin: AutomaticJobBuiltin, output: string | null): boolean {
	return jobOutputIssues(builtin, output).length === 0;
}

function chatNameIssues(name: string): readonly string[] {
	const words = name.split(/\s+/u);
	return [
		...(words.length > 3 ? [`${words.length} words`] : []),
		...(NAME_VERBS.has(firstWord(words)) ? ['Starts with a verb'] : []),
		...(TRAILING_PUNCTUATION.test(name) ? ['Ends with punctuation'] : []),
		...(QUOTES.test(name) ? ['Has quotes'] : []),
	];
}

function serviceNameIssues(name: string): readonly string[] {
	const task = TASK_PREFIX.test(name);
	const words = name.replace(TASK_PREFIX, '').split(/\s+/u);
	const limit = task ? 3 : 2;
	return [
		...(words.length > limit ? [`${words.length} words`] : []),
		...(name !== name.toLowerCase() ? ['Not lowercase'] : []),
		...(!task && SERVICE_VERBS.has(firstWord(words)) ? ['Starts with a verb'] : []),
		...(!task && words.length === 1 && SERVICE_TOOLS.has(firstWord(words))
			? ['Names the tool']
			: []),
		...(TRAILING_PUNCTUATION.test(name) ? ['Ends with punctuation'] : []),
	];
}

function firstWord(words: readonly string[]): string {
	return (words[0] ?? '').toLowerCase();
}

export function brokeRuleCount(
	builtin: AutomaticJobBuiltin,
	outputs: readonly (string | null)[],
): number {
	return outputs.filter((output) => !followsEveryRule(builtin, output)).length;
}
