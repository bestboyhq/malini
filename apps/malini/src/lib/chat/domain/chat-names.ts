import { DANGLING_WORDS } from '$contract/chat-identity';
import { promptChipFallbackLabel, promptChipSegments } from './prompt-chip';

const NAME_WORDS = 3;
const MESSAGE_CHARACTERS = 2_000;
const REPLY_CHARACTERS = 1_500;
const NAMER_TAG = /<\/?(?:message|reply|task)>/giu;
const CLAUSE_END = /[,;:(]|\s[-–—]\s/u;
const NAME_EDGE = /^["'`*_\s]+|["'`*_.!?\s]+$/gu;
const PLACEHOLDER_CHAT_NAME = /^(?:New chat(?: \d+)?|Chat \d+)$/u;
const CONNECTORS: ReadonlySet<string> = new Set([
	'about',
	'across',
	'after',
	'and',
	'as',
	'at',
	'before',
	'between',
	'by',
	'for',
	'from',
	'in',
	'into',
	'of',
	'on',
	'or',
	'over',
	'per',
	'to',
	'under',
	'via',
	'vs',
	'with',
	'without',
]);

const NO_TASK_WORDS: ReadonlySet<string> = new Set([
	'attachment',
	'confused',
	'conversation',
	'exchange',
	'exclamation',
	'greeting',
	'greetings',
	'hello',
	'help',
	'hi',
	'message',
	'only',
	'question',
	'quick',
	'reaction',
	'request',
	'screenshot',
	'small',
	'talk',
	'task',
	'unclear',
	'vague',
]);

export function isPlaceholderChatName(name: string): boolean {
	return PLACEHOLDER_CHAT_NAME.test(name.trim());
}

export function namerTask(message: string, reply: string | null): string | null {
	const said = namerText(message, MESSAGE_CHARACTERS);
	const answered = reply === null ? '' : namerText(reply, REPLY_CHARACTERS);
	if (said === '' && answered === '') return null;
	return [
		`<message>\n${said}\n</message>`,
		...(answered === '' ? [] : [`<reply>\n${answered}\n</reply>`]),
	].join('\n');
}

export function chatName(suggestion: string): string | null {
	const [clause = ''] = suggestion.trim().split(CLAUSE_END);
	const words = headWords(clause.replace(NAME_EDGE, '').split(/\s+/u).filter(Boolean));
	const name = words.join(' ');
	if (name.toLowerCase() === 'none' || words.every((word) => NO_TASK_WORDS.has(word.toLowerCase())))
		return null;
	return `${name.charAt(0).toLocaleUpperCase()}${name.slice(1)}`;
}

function namerText(text: string, limit: number): string {
	return promptChipSegments(text)
		.map((segment) =>
			segment.kind === 'text' ? segment.text : `[${promptChipFallbackLabel(segment.ref)}]`,
		)
		.join('')
		.replace(NAMER_TAG, '')
		.trim()
		.slice(0, limit);
}

function headWords(words: readonly string[]): string[] {
	const connector = words.findIndex(
		(word, index) => index >= 2 && CONNECTORS.has(word.toLowerCase()),
	);
	const head = words.length > NAME_WORDS && connector !== -1 ? words.slice(0, connector) : words;
	const kept = head.slice(-NAME_WORDS);
	while (kept.length > 1 && dangles(kept[0])) kept.shift();
	while (kept.length > 1 && dangles(kept.at(-1))) kept.pop();
	return kept;
}

function dangles(word: string | undefined): boolean {
	return (
		DANGLING_WORDS.has((word ?? '').toLowerCase()) || CONNECTORS.has((word ?? '').toLowerCase())
	);
}
