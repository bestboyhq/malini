import { redactSensitiveText } from '$main/diagnostics/redaction';

const SHORTEST_MASKED_SECRET = 4;

export const SECRET_MASK = '[secret]';

export function redactBrainText(text: string, home: string, secrets: readonly string[]): string {
	const masked = secrets
		.filter((secret) => secret.length >= SHORTEST_MASKED_SECRET)
		.sort((left, right) => right.length - left.length)
		.reduce((redacted, secret) => redacted.split(secret).join(SECRET_MASK), text);
	return redactSensitiveText(masked, home);
}

export type CapturedTurn = Readonly<{
	runId: string;
	prompts: readonly string[];
	outcome: string | null;
}>;

export type CapturedChat = Readonly<{
	sessionId: string;
	heading: string;
	turns: readonly CapturedTurn[];
	lastSeq: number;
}>;

export type TypedPrompt = Readonly<{
	seq: number;
	sessionId: string;
	runId: string;
	chatName: string;
	place: string;
	text: string;
	outcome: string | null;
	finished: boolean;
}>;

export function capturedChats(prompts: readonly TypedPrompt[]): CapturedChat[] {
	const chats = new Map<string, CapturedChat>();
	const stopped = new Set<string>();
	for (const prompt of prompts) {
		if (stopped.has(prompt.sessionId)) continue;
		if (!prompt.finished) {
			stopped.add(prompt.sessionId);
			continue;
		}
		chats.set(
			prompt.sessionId,
			withPrompt(chats.get(prompt.sessionId) ?? emptyChat(prompt), prompt),
		);
	}
	return [...chats.values()];
}

function emptyChat(prompt: TypedPrompt): CapturedChat {
	const name = prompt.chatName.trim() || 'Untitled chat';
	return {
		sessionId: prompt.sessionId,
		heading: `${name} - ${prompt.place}`,
		turns: [],
		lastSeq: 0,
	};
}

function withPrompt(chat: CapturedChat, prompt: TypedPrompt): CapturedChat {
	const last = chat.turns.at(-1);
	const sameRun = last?.runId === prompt.runId;
	const turn: CapturedTurn = {
		runId: prompt.runId,
		prompts: [...(sameRun ? last.prompts : []), prompt.text],
		outcome: prompt.outcome,
	};
	return {
		...chat,
		turns: [...(sameRun ? chat.turns.slice(0, -1) : chat.turns), turn],
		lastSeq: prompt.seq,
	};
}

export function logSection(chat: CapturedChat): string {
	const turns = chat.turns.map((turn) =>
		[
			...turn.prompts.map(quoted),
			...(turn.outcome === null ? [] : [`Outcome: ${turn.outcome}`]),
		].join('\n\n'),
	);
	return [`## ${chat.heading}`, ...turns].join('\n\n');
}

function quoted(text: string): string {
	return text
		.split('\n')
		.map((line) => (line.trim().length > 0 ? `> ${line}` : '>'))
		.join('\n');
}

export function logDay(at: Date): string {
	const pad = (value: number): string => String(value).padStart(2, '0');
	return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}
