const USABLE_REQUEST_ID = /^[A-Za-z0-9_-]+$/u;
const MAX_NAME_WORDS = 7;
const MAX_NAME_CHARACTERS = 52;
const CLAUSE_BOUNDARY = /[.!?:;](?=\s|$)|\n/u;
const CLAUSE_EDGE = /^[\s"'`#\-:;,]+|[\s"'`#\-:;,]+$/gu;
const WORD_EDGE = /^["'`,;:.!?]+|["'`,;:.!?]+$/gu;
const LEADING_FILLER = [
	'okay, so i want you to ',
	'okay so i want you to ',
	'i would like you to ',
	"i'd like you to ",
	'i want you to ',
	'could you please ',
	'would you please ',
	'can you please ',
	'could you ',
	'would you ',
	'can you ',
	'help me ',
	'please ',
	'okay, so ',
	'okay so ',
	'okay, ',
	'okay ',
	'hey, ',
	'hey ',
	'hi, ',
	'hi ',
	'also ',
] as const;
const DANGLING_WORDS = new Set([
	'a',
	'about',
	'an',
	'and',
	'are',
	'as',
	'at',
	'be',
	'but',
	'by',
	'do',
	'does',
	'for',
	'from',
	'i',
	'if',
	'in',
	'into',
	'is',
	'it',
	'its',
	'my',
	'not',
	'of',
	'on',
	'or',
	'our',
	'so',
	'that',
	'the',
	'their',
	'then',
	'these',
	'this',
	'those',
	'to',
	'via',
	'was',
	'we',
	'with',
	'you',
	'your',
]);

export function runIdForPromptRequest(requestId: string | null | undefined): string | null {
	const trimmed = requestId?.trim();
	if (!trimmed || !USABLE_REQUEST_ID.test(trimmed)) return null;
	return `run-${trimmed}`;
}

export function deriveAgentChatDisplayName(prompt: string): string | null {
	const clauses = prompt
		.split(CLAUSE_BOUNDARY)
		.map(withoutFiller)
		.filter((clause) => clause.length > 0);
	const clause = clauses.find((candidate) => candidate.includes(' ')) ?? clauses[0];
	if (clause === undefined) return null;

	const words: string[] = [];
	let characterCount = 0;
	for (const word of clause.split(' ')) {
		if (word.startsWith('(') || word.startsWith('[')) break;
		const cleaned = word.replace(WORD_EDGE, '');
		if (!cleaned) continue;
		const nextCount = characterCount + (words.length > 0 ? 1 : 0) + [...cleaned].length;
		if (words.length >= MAX_NAME_WORDS || nextCount > MAX_NAME_CHARACTERS) break;
		words.push(cleaned);
		characterCount = nextCount;
	}
	while (words.length > 1 && DANGLING_WORDS.has((words.at(-1) ?? '').toLocaleLowerCase())) {
		words.pop();
	}
	const title = words.join(' ');
	if (!title) return null;
	const [first = '', ...rest] = [...title];
	return `${first.toLocaleUpperCase()}${rest.join('')}`;
}

function withoutFiller(clause: string): string {
	let normalized = clause.split(/\s+/u).filter(Boolean).join(' ').replace(CLAUSE_EDGE, '');
	for (;;) {
		const lowercase = normalized.toLocaleLowerCase();
		const filler = LEADING_FILLER.find((candidate) => lowercase.startsWith(candidate));
		if (!filler) return normalized;
		normalized = normalized.slice(filler.length).trimStart();
	}
}
