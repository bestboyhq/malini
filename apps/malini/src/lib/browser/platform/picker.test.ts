import { describe, expect, it } from 'vitest';
import type { BrowserElementPrompt } from '$contract/browser';
import type { PageImage, Rectangle } from './page';
import { cropArea, pickElement, type PickerPage } from './picker';
import type { PickerCommand } from './picker-page';

const SELECTION = {
	domPath: 'main#app > button.buy',
	rect: { top: 100, left: 50, width: 200, height: 40 },
	html: '<button class="buy">Buy</button>',
	url: 'http://localhost:5173/pricing',
	viewport: { width: 1280, height: 800 },
};

const PNG: PageImage = {
	isEmpty: () => false,
	getSize: () => ({ width: 10, height: 10 }),
	resize: () => PNG,
	toPNG: () => Buffer.from('element png'),
	toJPEG: () => Buffer.from('element jpeg'),
};

interface Script {
	readonly selections: unknown[];
	readonly answers: Array<unknown | Promise<unknown>>;
	readonly source?: unknown;
}

function scriptedPage(script: Script) {
	const commands: PickerCommand[] = [];
	const captures: Array<Rectangle | undefined> = [];
	const page: PickerPage = {
		run: async (command) => {
			commands.push(command);
			if (command.kind === 'select') return script.selections.shift();
			if (command.kind === 'prompt') return script.answers.shift();
			return null;
		},
		readSource: async () => script.source ?? null,
		capture: async (area) => {
			captures.push(area);
			return PNG;
		},
		zoomFactor: () => 2,
	};
	return { page, commands, captures };
}

const MODELS = [
	{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
	{ id: 'claude-opus-5-5', label: 'Opus 5.5' },
];
const REQUEST = { model: 'claude-sonnet-5-5', models: MODELS };
const ASK = { kind: 'prompt', models: MODELS, model: 'claude-sonnet-5-5', error: null };

function threads(...outcomes: Array<string | Error>) {
	const started: BrowserElementPrompt[] = [];
	const start = async (picked: BrowserElementPrompt): Promise<string> => {
		started.push(picked);
		const outcome = outcomes.shift() ?? 'session-1';
		if (outcome instanceof Error) throw outcome;
		return outcome;
	};
	return { started, start };
}

describe('pickElement', () => {
	it('starts a thread with the prompt, the model, the element, its source, and a padded crop of it', async () => {
		const { page, commands, captures } = scriptedPage({
			selections: [SELECTION],
			answers: [{ kind: 'send', prompt: '  Make it green  ', model: 'claude-opus-5-5' }],
			source: 'src/routes/pricing/+page.svelte:42:6',
		});
		const { started, start } = threads('session-1');

		const picked = await pickElement(page, new AbortController().signal, REQUEST, start);

		expect(picked).toEqual({ sessionId: 'session-1', model: 'claude-opus-5-5' });
		expect(started).toEqual([
			{
				prompt: 'Make it green',
				model: 'claude-opus-5-5',
				element: {
					url: SELECTION.url,
					domPath: SELECTION.domPath,
					rect: SELECTION.rect,
					html: SELECTION.html,
					source: 'src/routes/pricing/+page.svelte:42:6',
				},
				screenshot: {
					mediaType: 'image/png',
					base64: Buffer.from('element png').toString('base64'),
				},
			},
		]);
		expect(captures).toEqual([{ x: 84, y: 184, width: 432, height: 112 }]);
		expect(commands).toEqual([{ kind: 'select', reselect: false }, ASK, { kind: 'end' }]);
	});

	it('keeps the prompt open with the reason when the thread does not start, then starts it', async () => {
		const { page, commands } = scriptedPage({
			selections: [SELECTION],
			answers: [
				{ kind: 'send', prompt: 'Bigger', model: 'claude-opus-5-5' },
				{ kind: 'send', prompt: 'Bigger', model: 'claude-opus-5-5' },
			],
		});
		const { started, start } = threads(new Error('Agent runtime unavailable'), 'session-2');

		const picked = await pickElement(page, new AbortController().signal, REQUEST, start);

		expect(picked).toEqual({ sessionId: 'session-2', model: 'claude-opus-5-5' });
		expect(started).toHaveLength(2);
		expect(commands).toEqual([
			{ kind: 'select', reselect: false },
			ASK,
			{ ...ASK, model: 'claude-opus-5-5', error: 'Agent runtime unavailable' },
			{ kind: 'end' },
		]);
	});

	it('picks again when the user clicks another element while the prompt is open', async () => {
		const { page, commands } = scriptedPage({
			selections: [SELECTION, { ...SELECTION, domPath: 'main#app > h1' }],
			answers: [
				{ kind: 'reselect' },
				{ kind: 'send', prompt: 'Bigger', model: 'claude-sonnet-5-5' },
			],
		});
		const { started, start } = threads();

		await pickElement(page, new AbortController().signal, REQUEST, start);

		expect(started[0]?.element.domPath).toBe('main#app > h1');
		expect(started[0]?.element.source).toBeUndefined();
		expect(commands).toEqual([
			{ kind: 'select', reselect: false },
			ASK,
			{ kind: 'select', reselect: true },
			ASK,
			{ kind: 'end' },
		]);
	});

	it('refuses a model malini did not offer', async () => {
		const { page, commands } = scriptedPage({
			selections: [SELECTION],
			answers: [{ kind: 'send', prompt: 'Bigger', model: 'claude-other-1' }],
		});
		const { started, start } = threads();

		await expect(pickElement(page, new AbortController().signal, REQUEST, start)).rejects.toThrow(
			'The element picker returned a prompt Malini cannot read.',
		);
		expect(started).toEqual([]);
		expect(commands.at(-1)).toEqual({ kind: 'end' });
	});

	it('ends with nothing when the user cancels in the page', async () => {
		const { page, commands } = scriptedPage({ selections: [null], answers: [] });
		await expect(
			pickElement(page, new AbortController().signal, REQUEST, threads().start),
		).resolves.toBeNull();
		expect(commands.at(-1)).toEqual({ kind: 'end' });
	});

	it('ends with nothing when malini cancels while the prompt is open', async () => {
		const controller = new AbortController();
		const { page, commands } = scriptedPage({
			selections: [SELECTION],
			answers: [new Promise(() => undefined)],
		});

		const picking = pickElement(page, controller.signal, REQUEST, threads().start);
		await Promise.resolve();
		await new Promise((resolve) => setTimeout(resolve, 0));
		controller.abort();

		await expect(picking).resolves.toBeNull();
		expect(commands.at(-1)).toEqual({ kind: 'end' });
	});

	it('refuses a selection it cannot read and still removes the picker', async () => {
		const { page, commands } = scriptedPage({
			selections: [{ ...SELECTION, domPath: 'body\n> main' }],
			answers: [],
		});
		await expect(
			pickElement(page, new AbortController().signal, REQUEST, threads().start),
		).rejects.toThrow('The element picker returned a selection Malini cannot read.');
		expect(commands.at(-1)).toEqual({ kind: 'end' });
	});

	it('drops a source location that is not one line', async () => {
		const { page } = scriptedPage({
			selections: [SELECTION],
			answers: [{ kind: 'send', prompt: 'x', model: 'claude-sonnet-5-5' }],
			source: 'src/a.svelte:1:1\nsrc/b.svelte:2:2',
		});
		const { started, start } = threads();
		await pickElement(page, new AbortController().signal, REQUEST, start);
		expect(started[0]?.element).not.toHaveProperty('source');
	});
});

describe('cropArea', () => {
	it('pads the element and keeps the crop inside the viewport', () => {
		const viewport = { width: 400, height: 300 };
		expect(cropArea({ top: 2, left: 390, width: 50, height: 20 }, viewport, 1)).toEqual({
			x: 382,
			y: 0,
			width: 18,
			height: 30,
		});
		expect(cropArea({ top: 400, left: 0, width: 10, height: 10 }, viewport, 1)).toBeUndefined();
	});
});
