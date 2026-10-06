import type { ExtensionCommitRun } from '@malini/extension-api';

export const AUTOMATED_PULL_REQUEST_METADATA_LIMITS = Object.freeze({
	title: 100,
	commitMessage: 100,
	body: 4_000,
	contextItem: 240,
	contextItems: 6,
	eventItem: 120,
	eventItems: 8,
	pathItem: 120,
	pathItems: 12,
});

export type PullRequestAutomationEventStatus =
	'passed' | 'failed' | 'pending' | 'completed' | 'unknown';

export type PullRequestAutomationEvent = Readonly<{
	kind: 'terminal' | 'validation';
	label: string;
	status?: PullRequestAutomationEventStatus;
	detail?: string;
}>;

export type PullRequestAutomationContext = Readonly<{
	sessionTitle?: string;
	lastUserIntent?: string;
	runSummaries?: readonly string[];
	latestRunId?: string;
	pullRequestTitle?: string;
	events?: readonly PullRequestAutomationEvent[];
}>;

export type AutomatedPullRequestMetadataInput = Readonly<{
	branch: string;
	baseBranch: string;
	changedPaths: readonly string[];
	context?: PullRequestAutomationContext;
}>;

export type AutomatedPullRequestMetadata = Readonly<{
	title: string;
	body: string;
	commitMessage: string;
	commitRun: ExtensionCommitRun | null;
}>;

export function sanitizePullRequestContextValue(value: string, limit: number): string {
	return singleLine(value, Math.max(0, Math.floor(limit)));
}

const GENERIC_SESSION_TITLES = new Set([
	'',
	'agent session',
	'chat',
	'new chat',
	'new session',
	'new task',
	'untitled',
]);

const DANGLING_TITLE_WORDS = new Set([
	'a',
	'an',
	'and',
	'as',
	'at',
	'but',
	'by',
	'for',
	'from',
	'in',
	'into',
	'of',
	'on',
	'onto',
	'or',
	'per',
	'than',
	'that',
	'the',
	'to',
	'via',
	'with',
	'within',
	'without',
]);

const REQUEST_PREFIX =
	/^(?:please\s+|can you\s+|could you\s+|would you\s+|i need (?:you )?to\s+)/iu;
const TRAILING_TITLE_NOISE = /[.!?:;,\-\s]+$/u;

const CONVENTIONAL_COMMIT_SUBJECT = /^[a-z]+(?:\([^)]*\))?!?: \S/u;

const DUPLICATE_NAME_COUNTER = /\s+(?:[2-9]|[1-9][0-9]+)$/u;

export function automatedPullRequestMetadata(
	input: AutomatedPullRequestMetadataInput,
): AutomatedPullRequestMetadata {
	const branch = singleLine(input.branch, AUTOMATED_PULL_REQUEST_METADATA_LIMITS.contextItem);
	const baseBranch = singleLine(
		input.baseBranch,
		AUTOMATED_PULL_REQUEST_METADATA_LIMITS.contextItem,
	);
	const changedPaths = normalizedChangedPaths(input.changedPaths);
	const context = normalizedContext(input.context);
	const title = workstreamTitle(branch, changedPaths, context);
	const body = boundedBody(
		buildBody({
			title,
			branch,
			baseBranch,
			changedPaths,
			context,
		}),
	);

	return {
		title,
		body,
		commitMessage: commitSubject(changedPaths, context),
		commitRun: commitRun(changedPaths, context),
	};
}

export type DerivedCommitMessageInput = Readonly<{
	changedPaths: readonly string[];
	context?: PullRequestAutomationContext;
}>;

export function derivedCommitMessage(input: DerivedCommitMessageInput): string {
	return commitSubject(
		normalizedChangedPaths(input.changedPaths),
		normalizedContext(input.context),
	);
}

function workstreamTitle(
	branch: string,
	changedPaths: readonly string[],
	context: Required<PullRequestAutomationContext>,
): string {
	return boundedTitle(
		firstUseful([
			firstSentence(context.pullRequestTitle),
			...context.runSummaries.map(firstSentence).reverse(),
			firstSentence(context.lastUserIntent),
			context.sessionTitle,
			branchTitle(branch),
			changedPathTitle(changedPaths),
			'Update workstream',
		]),
		AUTOMATED_PULL_REQUEST_METADATA_LIMITS.title,
	);
}

function commitSubject(
	changedPaths: readonly string[],
	context: Required<PullRequestAutomationContext>,
): string {
	return boundedTitle(
		firstUseful([
			firstSentence(context.runSummaries.at(-1) ?? ''),
			firstSentence(context.lastUserIntent),
			changedPathTitle(changedPaths),
			'Update workstream',
		]),
		AUTOMATED_PULL_REQUEST_METADATA_LIMITS.commitMessage,
	);
}

function commitRun(
	changedPaths: readonly string[],
	context: Required<PullRequestAutomationContext>,
): ExtensionCommitRun | null {
	if (!context.latestRunId || context.runSummaries.length === 0) return null;
	return {
		id: context.latestRunId,
		messageIfAlreadyCommitted: commitSubject(changedPaths, { ...context, runSummaries: [] }),
	};
}

function normalizedChangedPaths(changedPaths: readonly string[]): readonly string[] {
	return uniqueSorted(
		changedPaths
			.map((path) => singleLine(path, AUTOMATED_PULL_REQUEST_METADATA_LIMITS.pathItem))
			.filter(Boolean),
	);
}

function normalizedContext(
	context?: PullRequestAutomationContext,
): Required<PullRequestAutomationContext> {
	if (!context) {
		return {
			sessionTitle: '',
			lastUserIntent: '',
			runSummaries: [],
			latestRunId: '',
			pullRequestTitle: '',
			events: [],
		};
	}
	return {
		sessionTitle: withoutDuplicateNameCounter(
			proseLine(context.sessionTitle ?? '', AUTOMATED_PULL_REQUEST_METADATA_LIMITS.contextItem),
		),
		lastUserIntent: proseLine(
			context.lastUserIntent ?? '',
			AUTOMATED_PULL_REQUEST_METADATA_LIMITS.contextItem,
		),
		runSummaries: uniqueInOrder(
			(context.runSummaries ?? [])
				.map((summary) => proseLine(summary, AUTOMATED_PULL_REQUEST_METADATA_LIMITS.contextItem))
				.filter(Boolean),
		).slice(0, AUTOMATED_PULL_REQUEST_METADATA_LIMITS.contextItems),
		latestRunId: singleLine(
			context.latestRunId ?? '',
			AUTOMATED_PULL_REQUEST_METADATA_LIMITS.contextItem,
		),
		pullRequestTitle: proseLine(
			context.pullRequestTitle ?? '',
			AUTOMATED_PULL_REQUEST_METADATA_LIMITS.contextItem,
		),
		events: (context.events ?? [])
			.map(normalizedEvent)
			.filter((event): event is PullRequestAutomationEvent => event !== null)
			.slice(0, AUTOMATED_PULL_REQUEST_METADATA_LIMITS.eventItems),
	};
}

function normalizedEvent(event: PullRequestAutomationEvent): PullRequestAutomationEvent | null {
	const label = proseLine(event.label, AUTOMATED_PULL_REQUEST_METADATA_LIMITS.eventItem);
	if (!label) return null;
	const detail = proseLine(event.detail ?? '', AUTOMATED_PULL_REQUEST_METADATA_LIMITS.eventItem);
	return {
		kind: event.kind,
		label,
		...(event.status ? { status: event.status } : {}),
		...(detail ? { detail } : {}),
	};
}

function buildBody(
	input: Readonly<{
		title: string;
		branch: string;
		baseBranch: string;
		changedPaths: readonly string[];
		context: Required<PullRequestAutomationContext>;
	}>,
): string {
	const sections: string[] = [];
	const summary =
		input.context.pullRequestTitle ||
		input.context.runSummaries.at(-1) ||
		input.context.lastUserIntent ||
		input.title;
	sections.push('## Summary', '', markdownProse(summary));

	const branch = markdownCode(input.branch || 'current workstream');
	const baseBranch = markdownCode(input.baseBranch || 'default branch');
	sections.push('', `Publish ${branch} against ${baseBranch}.`);
	if (input.changedPaths.length > 0) {
		const visiblePaths = input.changedPaths.slice(
			0,
			AUTOMATED_PULL_REQUEST_METADATA_LIMITS.pathItems,
		);
		sections.push('', ...visiblePaths.map((path) => `- ${markdownCode(path)}`));
		const hiddenPathCount = input.changedPaths.length - visiblePaths.length;
		if (hiddenPathCount > 0) sections.push(`- ${hiddenPathCount} more changed path(s)`);
	} else {
		sections.push('', '- No uncommitted paths; publish existing local commits.');
	}

	sections.push('', '## Validation', '');
	if (input.context.events.length > 0) {
		for (const event of input.context.events) {
			const status = eventStatusLabel(event.status);
			const detail = event.detail ? ` - ${markdownProse(event.detail)}` : '';
			sections.push(
				`- ${status}${event.kind === 'terminal' ? 'Terminal' : 'Validation'}: ${markdownProse(event.label)}${detail}`,
			);
		}
	} else {
		sections.push('- No validation results were reported for this session.');
	}

	return sections.join('\n').trim();
}

function eventStatusLabel(status?: PullRequestAutomationEventStatus): string {
	return {
		passed: 'Passed - ',
		failed: 'Failed - ',
		pending: 'Pending - ',
		completed: 'Completed - ',
		unknown: '',
	}[status ?? 'unknown'];
}

function firstUseful(candidates: readonly string[]): string {
	for (const candidate of candidates) {
		const normalized = titleText(candidate);
		if (!GENERIC_SESSION_TITLES.has(normalized.toLocaleLowerCase())) return normalized;
	}
	return 'Update workstream';
}

function boundedTitle(value: string, limit: number): string {
	const phrase = titlePhrase(value.replace(REQUEST_PREFIX, ''));
	if (!phrase) return 'Update workstream';
	const titled = CONVENTIONAL_COMMIT_SUBJECT.test(phrase)
		? phrase
		: `${phrase.charAt(0).toLocaleUpperCase()}${phrase.slice(1)}`;
	if (codePointLength(titled) <= limit) return titled;
	const head = wordBoundaryHead(titled, limit - 1);
	return `${titlePhrase(head) || head}…`;
}

function titlePhrase(value: string): string {
	let phrase = value.trim().replace(TRAILING_TITLE_NOISE, '');
	for (;;) {
		const words = phrase.split(' ');
		const last = words.at(-1)?.toLocaleLowerCase() ?? '';
		if (words.length < 2 || !DANGLING_TITLE_WORDS.has(last)) return phrase;
		phrase = words.slice(0, -1).join(' ').replace(TRAILING_TITLE_NOISE, '');
	}
}

function wordBoundaryHead(value: string, limit: number): string {
	const characters = Array.from(value);
	if (characters.length <= limit) return value;
	const head = characters.slice(0, limit).join('');
	if (characters[limit] === ' ') return head;
	const boundary = head.lastIndexOf(' ');
	return boundary >= Math.floor(limit * WORD_BOUNDARY_FLOOR) ? head.slice(0, boundary) : head;
}

const WORD_BOUNDARY_FLOOR = 0.6;

function boundedBody(value: string): string {
	const limit = AUTOMATED_PULL_REQUEST_METADATA_LIMITS.body;
	if (codePointLength(value) <= limit) return value;
	const head = bounded(value, limit - 2);
	const lastLineBreak = head.lastIndexOf('\n');
	return `${(lastLineBreak > 0 ? head.slice(0, lastLineBreak) : head).trimEnd()}\n…`;
}

function branchTitle(branch: string): string {
	const leaf = branch.split('/').filter(Boolean).at(-1) ?? '';
	const words = leaf.replace(/[-_.]+/gu, ' ').trim();
	if (!words || /^(?:main|master|develop|development)$/iu.test(words)) return '';
	return words;
}

function changedPathTitle(paths: readonly string[]): string {
	if (paths.length === 0) return '';
	if (paths.length > 1) {
		const topLevel = uniqueSorted(paths.map((path) => path.split('/')[0] ?? '').filter(Boolean));
		if (topLevel.length === 1) return `Update ${friendlyPath(topLevel[0] ?? '')}`;
		return 'Update repository changes';
	}
	return `Update ${friendlyPath(paths[0] ?? '')}`;
}

function friendlyPath(path: string): string {
	const name = path.split('/').filter(Boolean).at(-1) ?? path;
	return (
		name
			.replace(/\.[^.]+$/u, '')
			.replace(/[-_.]+/gu, ' ')
			.trim() || 'repository changes'
	);
}

function titleText(value: string): string {
	return singleLine(value, AUTOMATED_PULL_REQUEST_METADATA_LIMITS.contextItem)
		.replace(/^#{1,6}\s*/u, '')
		.replace(/^[`'"*_~]+|[`'"*_~]+$/gu, '')
		.trim();
}

function firstSentence(value: string): string {
	const normalized = singleLine(value, AUTOMATED_PULL_REQUEST_METADATA_LIMITS.contextItem);
	return normalized.split(/(?<=[.!?])\s+/u)[0] ?? normalized;
}

function singleLine(value: string, limit: number): string {
	return bounded(sanitizedLine(value), limit);
}

function proseLine(value: string, limit: number): string {
	const sanitized = sanitizedLine(value);
	if (limit <= 1 || codePointLength(sanitized) <= limit) return bounded(sanitized, limit);
	return `${wordBoundaryHead(sanitized, limit - 1).replace(TRAILING_TITLE_NOISE, '')}…`;
}

function sanitizedLine(value: string): string {
	return redactSecrets(stripUnsafeCharacters(value)).replace(/\s+/gu, ' ').trim();
}

function withoutDuplicateNameCounter(value: string): string {
	const stripped = value.replace(DUPLICATE_NAME_COUNTER, '').trim();
	return /\p{L}/u.test(stripped) ? stripped : value;
}

function stripUnsafeCharacters(value: string): string {
	return value
		.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/gu, '')
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, ' ')
		.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, ' ');
}

function redactSecrets(value: string): string {
	return value
		.replace(/\b(Bearer)\s+[^\s]+/giu, '$1 [redacted]')
		.replace(/\b(gh[opusr]_[A-Za-z0-9_]{8,})\b/gu, '[redacted]')
		.replace(
			/\b(api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)\s*[:=]\s*([^\s,;]+)/giu,
			'$1=[redacted]',
		)
		.replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/giu, '$1[redacted]@');
}

function markdownProse(value: string): string {
	return value
		.replace(/[\\<>[\]]/gu, '\\$&')
		.replace(/(^|[\s(])([@#])(?=[\w-])/gu, '$1\\$2')
		.replace(
			LEADING_BLOCK_MARKER,
			(_match, indent: string, marker: string) =>
				`${indent}${marker.replace(/[^\p{L}\p{N}\s]/gu, '\\$&')}`,
		);
}

const LEADING_BLOCK_MARKER = /^(\s*)((?:[-+*]|#{1,6}|\d{1,9}[.)])(?=\s|$)|[`~]{3,}|[-=_*]{3,}|\|)/u;

function markdownCode(value: string): string {
	return `\`${value.replace(/`/gu, '\\`')}\``;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
	return [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function uniqueInOrder(values: readonly string[]): readonly string[] {
	return [...new Set(values)];
}

function bounded(value: string, limit: number): string {
	return Array.from(value).slice(0, limit).join('');
}

function codePointLength(value: string): number {
	return Array.from(value).length;
}
