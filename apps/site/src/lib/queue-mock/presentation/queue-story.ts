export type ToolIcon = 'note' | 'search' | 'pencil';

export type Row =
	| { kind: 'thought'; key: string; text: string; seconds: number }
	| { kind: 'thinking'; key: string; text: string }
	| {
			kind: 'tool';
			key: string;
			icon: ToolIcon;
			label: string;
			running: boolean;
			added: number;
			removed: number;
	  }
	| { kind: 'bash'; key: string; description: string; command: string; running: boolean }
	| { kind: 'say'; key: string; text: string };

export type Run = {
	id: string;
	prompt: string;
	rows: readonly Row[];
	ended: 'cancelled' | 'completed' | null;
};

export type Changes = { files: number; added: number; removed: number };

export type Scene = {
	runs: readonly Run[];
	queue: readonly string[];
	draft: string;
	sent: string | null;
	changes: Changes | null;
	usage: boolean;
};

export type Token = { text: string; style: 'plain' | 'code' | 'strong' };

const MIDDLEWARE = 'src/middleware/rate-limit.ts';
const RETRY_AFTER = 'Send Retry-After with every 429 response.';
const RESET_TEST = 'Add a test for the reset header.';
const STEER = 'Also document the headers in the README.';
const STEER_THOUGHT = [
	'The user wants the README to explain the new headers before the tests run. ',
	'Add a short Rate limits section.',
];
const TYPING_LEAD_MS = 320;
const TYPING_TAIL_MS = 420;
const KEY_MS = 30;
const KEY_JITTER_MS = [14, 31, 6, 22, 10, 27, 18, 2, 34, 12, 25, 8];
const WORD_PAUSE_MS = 34;

export const FIRST_RUN = 'r1';

export function keyDelays(text: string): number[] {
	return [...text].map((_, index) => {
		if (index === 0) return TYPING_LEAD_MS;
		const pause = text[index - 1] === ' ' ? WORD_PAUSE_MS : 0;
		return KEY_MS + (KEY_JITTER_MS[index % KEY_JITTER_MS.length] ?? 0) + pause;
	});
}

function typingMs(text: string): number {
	return keyDelays(text).reduce((sum, delay) => sum + delay, TYPING_TAIL_MS);
}

export function tokens(text: string): Token[] {
	return text
		.split(/(`[^`]+`|\*\*[^*]+\*\*)/u)
		.filter(Boolean)
		.flatMap((part): Token[] => {
			if (part.startsWith('`')) return [{ text: part.slice(1, -1), style: 'code' }];
			if (part.startsWith('**')) return [{ text: part.slice(2, -2), style: 'strong' }];
			return part
				.split(/(\s+)/u)
				.filter(Boolean)
				.map((word) => ({ text: word, style: 'plain' }));
		});
}

const SENTENCE_BREAK = /(?<=[.!?…])\s+(?=\S)/u;

export function thinkingTicker(text: string): { key: number; line: string } {
	const sentences = text.trim().split(SENTENCE_BREAK);
	return { key: sentences.length, line: sentences.at(-1) ?? '' };
}

function tool(key: string, icon: ToolIcon, label: string, added = 0, removed = 0): Row {
	return { kind: 'tool', key, icon, label, running: false, added, removed };
}

function running(row: Row): Row {
	return row.kind === 'tool' || row.kind === 'bash' ? { ...row, running: true } : row;
}

const RUN_TESTS: Row = {
	kind: 'bash',
	key: 'bash-1',
	description: 'Run the rate limit tests',
	command: 'pnpm test rate-limit',
	running: true,
};

function buildStory(): { ms: number; scene: Scene }[] {
	let scene: Scene = {
		runs: [
			{
				id: FIRST_RUN,
				prompt: 'Send RateLimit headers on every API response.',
				ended: null,
				rows: [
					{
						kind: 'thought',
						key: 'think-1',
						seconds: 4,
						text: 'Read the middleware and where it is mounted first.',
					},
					tool('read-1', 'note', `Read · ${MIDDLEWARE}`),
					tool('grep-1', 'search', 'Grep · rateLimit\\('),
					tool('read-2', 'note', 'Read · src/server.ts'),
					tool('read-3', 'note', 'Read · tests/rate-limit.test.ts'),
					{
						kind: 'say',
						key: 'say-1',
						text: 'The bucket already knows the limit, the remaining budget and when the window resets. I will send them as `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` from the middleware, so every response carries them.',
					},
					tool('edit-1', 'pencil', `Edit · ${MIDDLEWARE}`, 5, 1),
				],
			},
		],
		queue: [],
		draft: '',
		sent: null,
		changes: null,
		usage: false,
	};
	const beats: { ms: number; scene: Scene }[] = [];

	const beat = (ms: number, next: Partial<Scene> = {}): void => {
		scene = { ...scene, draft: '', sent: null, ...next };
		beats.push({ ms, scene });
	};
	const runs = (id: string, change: (run: Run) => Run): readonly Run[] =>
		scene.runs.map((run) => (run.id === id ? change(run) : run));
	const add = (id: string, row: Row): readonly Run[] =>
		runs(id, (run) => ({ ...run, rows: [...run.rows, row] }));
	const settle = (id: string, key: string, row?: Row): readonly Run[] =>
		runs(id, (run) => ({
			...run,
			rows: run.rows.map((current) =>
				current.key !== key
					? current
					: (row ??
						(current.kind === 'tool' || current.kind === 'bash'
							? { ...current, running: false }
							: current)),
			),
		}));
	const type = (text: string): void => beat(typingMs(text), { draft: text });

	beat(1300);
	type(RETRY_AFTER);
	beat(950, { sent: RETRY_AFTER, queue: [RETRY_AFTER] });
	beat(700, {
		runs: add(FIRST_RUN, {
			kind: 'say',
			key: 'say-2',
			text: 'Now running the rate limit tests to check the headers on a 200 and a 429.',
		}),
	});
	type(RESET_TEST);
	beat(750, { sent: RESET_TEST, queue: [RETRY_AFTER, RESET_TEST] });
	beat(650, { runs: add(FIRST_RUN, RUN_TESTS) });
	type(STEER);
	beat(320, {
		sent: STEER,
		runs: [...scene.runs, { id: 'r2', prompt: STEER, rows: [], ended: null }],
	});
	beat(480, {
		runs: runs(FIRST_RUN, (run) => ({
			...run,
			ended: 'cancelled',
			rows: run.rows.filter((row) => row.key !== RUN_TESTS.key),
		})),
	});
	beat(700, {
		changes: { files: 1, added: 5, removed: 1 },
		runs: add('r2', { kind: 'thinking', key: 'think-steer', text: STEER_THOUGHT[0] ?? '' }),
	});
	beat(800, {
		runs: settle('r2', 'think-steer', {
			kind: 'thinking',
			key: 'think-steer',
			text: STEER_THOUGHT.join(''),
		}),
	});
	scene = {
		...scene,
		runs: settle('r2', 'think-steer', {
			kind: 'thought',
			key: 'think-steer',
			seconds: 1,
			text: STEER_THOUGHT.join(''),
		}),
	};
	beat(360, { runs: add('r2', running(tool('read-readme', 'note', 'Read · README.md'))) });
	beat(420, { runs: settle('r2', 'read-readme') });
	beat(950, {
		runs: add('r2', {
			kind: 'say',
			key: 'say-steer',
			text: 'Adding a **Rate limits** section to the README that lists the three headers and what each one means.',
		}),
	});
	beat(320, { runs: add('r2', running(tool('edit-readme', 'pencil', 'Edit · README.md', 4))) });
	beat(1050, { runs: settle('r2', 'edit-readme') });
	beat(650, {
		runs: add('r2', {
			kind: 'say',
			key: 'say-steer-2',
			text: 'The README now documents the headers.',
		}),
	});
	beat(500, {
		usage: true,
		changes: { files: 2, added: 9, removed: 1 },
		runs: runs('r2', (run) => ({ ...run, ended: 'completed' })),
	});
	beat(900, {
		queue: [RESET_TEST],
		runs: [...scene.runs, { id: 'r3', prompt: RETRY_AFTER, rows: [], ended: null }],
	});
	beat(420, { runs: add('r3', running(tool('read-q1', 'note', `Read · ${MIDDLEWARE}`))) });
	beat(300, { runs: settle('r3', 'read-q1') });
	beat(340, { runs: add('r3', running(tool('edit-q1', 'pencil', `Edit · ${MIDDLEWARE}`, 1))) });
	beat(650, { runs: settle('r3', 'edit-q1') });
	beat(2800, {
		runs: add('r3', {
			kind: 'say',
			key: 'say-q1',
			text: 'A 429 now also sends `Retry-After` with the seconds until the window resets.',
		}),
	});
	return beats;
}

export const STORY = buildStory();
