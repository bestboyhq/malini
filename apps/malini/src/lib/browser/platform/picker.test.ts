import { describe, expect, it } from 'vitest';
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

describe('pickElement', () => {
	it('returns the prompt with the element, its source, and a padded crop of it', async () => {
		const { page, commands, captures } = scriptedPage({
			selections: [SELECTION],
			answers: [{ kind: 'send', prompt: '  Make it green  ' }],
			source: 'src/routes/pricing/+page.svelte:42:6',
		});

		const picked = await pickElement(page, new AbortController().signal);

		expect(picked).toEqual({
			prompt: 'Make it green',
			element: {
				url: SELECTION.url,
				domPath: SELECTION.domPath,
				rect: SELECTION.rect,
				html: SELECTION.html,
				source: 'src/routes/pricing/+page.svelte:42:6',
			},
			screenshot: { mediaType: 'image/png', base64: Buffer.from('element png').toString('base64') },
		});
		expect(captures).toEqual([{ x: 84, y: 184, width: 432, height: 112 }]);
		expect(commands).toEqual([
			{ kind: 'select', reselect: false },
			{ kind: 'prompt' },
			{ kind: 'end' },
		]);
	});

	it('picks again when the user clicks another element while the prompt is open', async () => {
		const { page, commands } = scriptedPage({
			selections: [SELECTION, { ...SELECTION, domPath: 'main#app > h1' }],
			answers: [{ kind: 'reselect' }, { kind: 'send', prompt: 'Bigger' }],
		});

		const picked = await pickElement(page, new AbortController().signal);

		expect(picked?.element.domPath).toBe('main#app > h1');
		expect(picked?.element.source).toBeUndefined();
		expect(commands).toEqual([
			{ kind: 'select', reselect: false },
			{ kind: 'prompt' },
			{ kind: 'select', reselect: true },
			{ kind: 'prompt' },
			{ kind: 'end' },
		]);
	});

	it('ends with nothing when the user cancels in the page', async () => {
		const { page, commands } = scriptedPage({ selections: [null], answers: [] });
		await expect(pickElement(page, new AbortController().signal)).resolves.toBeNull();
		expect(commands.at(-1)).toEqual({ kind: 'end' });
	});

	it('ends with nothing when malini cancels while the prompt is open', async () => {
		const controller = new AbortController();
		const { page, commands } = scriptedPage({
			selections: [SELECTION],
			answers: [new Promise(() => undefined)],
		});

		const picking = pickElement(page, controller.signal);
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
		await expect(pickElement(page, new AbortController().signal)).rejects.toThrow(
			'The element picker returned a selection malini cannot read.',
		);
		expect(commands.at(-1)).toEqual({ kind: 'end' });
	});

	it('drops a source location that is not one line', async () => {
		const { page } = scriptedPage({
			selections: [SELECTION],
			answers: [{ kind: 'send', prompt: 'x' }],
			source: 'src/a.svelte:1:1\nsrc/b.svelte:2:2',
		});
		const picked = await pickElement(page, new AbortController().signal);
		expect(picked?.element).not.toHaveProperty('source');
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
