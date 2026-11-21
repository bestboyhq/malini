import { constants } from 'node:os';

export const GIT_SUBCOMMANDS = [
	'add',
	'am',
	'apply',
	'archive',
	'blame',
	'branch',
	'cat-file',
	'check-ignore',
	'check-ref-format',
	'checkout',
	'cherry-pick',
	'clean',
	'clone',
	'commit',
	'commit-tree',
	'config',
	'count-objects',
	'credential',
	'describe',
	'diff',
	'diff-files',
	'diff-index',
	'diff-tree',
	'fetch',
	'for-each-ref',
	'fsck',
	'gc',
	'grep',
	'hash-object',
	'init',
	'lfs',
	'log',
	'ls-files',
	'ls-remote',
	'ls-tree',
	'maintenance',
	'merge',
	'merge-base',
	'merge-file',
	'merge-tree',
	'mv',
	'notes',
	'pull',
	'push',
	'read-tree',
	'rebase',
	'reflog',
	'remote',
	'repack',
	'reset',
	'restore',
	'rev-list',
	'rev-parse',
	'revert',
	'rm',
	'show',
	'show-ref',
	'sparse-checkout',
	'stash',
	'status',
	'submodule',
	'switch',
	'symbolic-ref',
	'tag',
	'update-index',
	'update-ref',
	'var',
	'version',
	'worktree',
	'write-tree',
	'other',
] as const;

export type GitSubcommand = (typeof GIT_SUBCOMMANDS)[number];

export const GIT_SAID = [
	'dubious-ownership',
	'bad-object',
	'index-corrupt',
	'head-invalid',
	'unknown-revision',
	'pathspec',
	'not-a-work-tree',
	'permission-denied',
	'no-space',
	'developer-tools-missing',
	'license-not-accepted',
	'clone-target-exists',
	'shallow-or-partial',
	'unrecognized',
] as const;

export type GitSaid = (typeof GIT_SAID)[number];

export const GH_SUBCOMMANDS = [
	'api',
	'auth',
	'browse',
	'gist',
	'issue',
	'label',
	'pr',
	'release',
	'repo',
	'run',
	'search',
	'secret',
	'status',
	'variable',
	'version',
	'workflow',
	'other',
] as const;

export type GhSubcommand = (typeof GH_SUBCOMMANDS)[number];

export const GH_SAID = [
	'not-found',
	'forbidden',
	'unprocessable',
	'graphql',
	'already-exists',
	'no-commits',
	'not-json',
	'output-too-large',
	'spawn-failed',
	'unrecognized',
] as const;

export type GhSaid = (typeof GH_SAID)[number];

export const SIGNAL_NAMES: readonly string[] = Object.keys(constants.signals);

const GIT_SAID_PATTERNS: readonly (readonly [GitSaid, RegExp])[] = [
	['dubious-ownership', /detected dubious ownership|safe\.directory/iu],
	[
		'developer-tools-missing',
		/xcrun: error|invalid active developer path|no developer tools were found|requires the command line developer tools/iu,
	],
	['license-not-accepted', /xcode(?:\/ios)? license|agreeing to the xcode/iu],
	['no-space', /no space left on device|disk quota exceeded/iu],
	[
		'index-corrupt',
		/index file corrupt|bad index file|index file smaller than expected|unknown index entry format|index uses .* extension, which we do not understand|bad signature 0x/iu,
	],
	[
		'head-invalid',
		/bad head\b|unable to resolve head|head is not a valid|ambiguous argument 'head'|not a valid object name:? '?head|failed to resolve 'head'|reference broken|bad revision 'head'|current branch appears to be broken/iu,
	],
	[
		'bad-object',
		/bad object|loose object .* is corrupt|object file .* is empty|unable to read tree|missing (?:blob|tree|commit) object|invalid object|packfile .* cannot be accessed|inflate: data stream error|sha1 mismatch|hash mismatch/iu,
	],
	['shallow-or-partial', /promisor remote|partial clone|shallow (?:update|file)|unshallow/iu],
	[
		'not-a-work-tree',
		/not a git repository|must be run in a work tree|is not a working tree|not a working tree|gitdir file points to non-existent location|gitfile does not point to a valid repository|invalid gitfile format|\.git' does not exist|invalid path '[^']+': no such file or directory/iu,
	],
	[
		'unknown-revision',
		/unknown revision|bad revision|needed a single revision|invalid reference|not a valid object name|not a valid ref|couldn't find remote ref/iu,
	],
	['pathspec', /pathspec .* did not match|is outside repository|outside of the repository/iu],
	[
		'clone-target-exists',
		/destination path .* already exists and is not an empty directory|already exists and is not an empty directory/iu,
	],
	['permission-denied', /permission denied|operation not permitted|insufficient permission/iu],
];

const GH_SAID_PATTERNS: readonly (readonly [GhSaid, RegExp])[] = [
	['not-found', /\bHTTP 404\b|could not resolve to an? |not found/iu],
	['forbidden', /\bHTTP 403\b|resource not accessible|must have (?:admin|push|write) access/iu],
	['already-exists', /already exists/iu],
	['no-commits', /no commits between/iu],
	['unprocessable', /\bHTTP 422\b|validation failed/iu],
	['graphql', /^graphql:/imu],
];

export function gitSaid(output: string): GitSaid {
	return GIT_SAID_PATTERNS.find(([, pattern]) => pattern.test(output))?.[0] ?? 'unrecognized';
}

export function ghSaid(stderr: string): GhSaid {
	return GH_SAID_PATTERNS.find(([, pattern]) => pattern.test(stderr))?.[0] ?? 'unrecognized';
}

export function gitSubcommand(args: readonly string[]): GitSubcommand {
	let index = 0;
	for (; index < args.length; index += 1) {
		const argument = args[index] ?? '';
		if (argument === '-C' || argument === '-c') index += 1;
		else if (!argument.startsWith('-')) break;
	}
	return knownOrOther(GIT_SUBCOMMANDS, args[index]);
}

export function ghSubcommand(args: readonly string[]): GhSubcommand {
	return knownOrOther(
		GH_SUBCOMMANDS,
		args.find((argument) => !argument.startsWith('-')),
	);
}

function knownOrOther<const T extends readonly string[]>(
	known: T,
	value: string | undefined,
): T[number] | 'other' {
	return known.find((entry) => entry === value) ?? 'other';
}

const GIT_MESSAGE_WORDS: ReadonlySet<string> = new Set([
	'a',
	'aborting',
	'access',
	'already',
	'an',
	'and',
	'another',
	'any',
	'are',
	'argument',
	'as',
	'at',
	'bad',
	'be',
	'because',
	'been',
	'blob',
	'branch',
	'broken',
	'but',
	'by',
	'cache',
	'can',
	'cannot',
	'checked',
	'checkout',
	'clone',
	'commit',
	'commits',
	'config',
	'configuration',
	'conflict',
	'contains',
	'copy',
	'corrupt',
	'could',
	'create',
	'current',
	'currently',
	'denied',
	'detached',
	'did',
	'directory',
	'does',
	'empty',
	'entry',
	'error',
	'exist',
	'exists',
	'expected',
	'failed',
	'fatal',
	'fetch',
	'file',
	'files',
	'find',
	'for',
	'from',
	'git',
	'gitdir',
	'has',
	'have',
	'head',
	'here',
	'in',
	'index',
	'invalid',
	'is',
	'it',
	'its',
	'linked',
	'local',
	'lock',
	'locked',
	'loose',
	'match',
	'matched',
	'may',
	'merge',
	'missing',
	'more',
	'must',
	'name',
	'needed',
	'no',
	'non-existent',
	'not',
	'nothing',
	'object',
	'objects',
	'of',
	'on',
	'one',
	'only',
	'open',
	'operation',
	'or',
	'origin',
	'other',
	'out',
	'outside',
	'over',
	'pack',
	'packfile',
	'parent',
	'path',
	'pathspec',
	'permission',
	'please',
	'points',
	'prune',
	'read',
	'reading',
	'rebase',
	'ref',
	'reference',
	'refs',
	'refusing',
	'remote',
	'remove',
	'repository',
	'resolve',
	'revision',
	'run',
	'same',
	'set',
	'short',
	'single',
	'smaller',
	'some',
	'specified',
	'stat',
	'still',
	'such',
	'than',
	'that',
	'the',
	'there',
	'this',
	'to',
	'too',
	'tree',
	'unable',
	'unknown',
	'up',
	'update',
	'upstream',
	'use',
	'used',
	'valid',
	'was',
	'when',
	'with',
	'work',
	'working',
	'worktree',
	'would',
	'write',
	'you',
	'your',
]);

const QUOTED_SPAN = /'[^']*'|"[^"]*"|`[^`]*`/gu;
const EDGE_PUNCTUATION = /^([([{]*)(.*?)([)\]}.,:;!?]*)$/u;
const TEMPLATE_HOLE = '_';
const MAX_TEMPLATE_CHARS = 160;

export function gitMessageTemplate(output: string): string | null {
	const lines = output
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => /^(?:fatal|error):/iu.test(line));
	const verdict = lines.filter((line) => /^fatal:/iu.test(line)).at(-1) ?? lines.at(-1);
	if (verdict === undefined) return null;
	const tokens = verdict
		.replace(/^(?:fatal|error):\s*/iu, '')
		.replace(QUOTED_SPAN, TEMPLATE_HOLE)
		.split(/\s+/u)
		.filter((token) => token.length > 0)
		.map(templateToken);
	const collapsed = tokens.filter(
		(token, index) => token !== TEMPLATE_HOLE || tokens[index - 1] !== TEMPLATE_HOLE,
	);
	const template = collapsed.join(' ').slice(0, MAX_TEMPLATE_CHARS).trim();
	return template.length > 0 ? template : null;
}

function templateToken(token: string): string {
	const [, open = '', core = '', close = ''] = EDGE_PUNCTUATION.exec(token) ?? [];
	const word = core.toLowerCase();
	if (!GIT_MESSAGE_WORDS.has(word)) return TEMPLATE_HOLE;
	return `${open.replace(/[^([{]/gu, '')}${word}${close}`;
}

export function isGitMessageTemplate(value: string): boolean {
	return (
		value.length <= MAX_TEMPLATE_CHARS &&
		value.split(' ').every((token) => {
			if (token === TEMPLATE_HOLE) return true;
			const [, , core = '', close = ''] = EDGE_PUNCTUATION.exec(token) ?? [];
			return GIT_MESSAGE_WORDS.has(core) && /^[)\]}.,:;!?]*$/u.test(close);
		})
	);
}
