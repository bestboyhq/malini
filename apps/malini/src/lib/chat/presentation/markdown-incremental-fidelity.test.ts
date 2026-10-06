// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: {} }));

import {
	createStreamingMarkdownRenderer,
	renderSanitizedHtml,
	splitMarkdownChunks,
} from './MarkdownText.svelte';

type CodeBlockProps = { code: string; safeHtml: string };

function mountStubCodeBlock(target: HTMLElement, props: CodeBlockProps) {
	const live = { ...props };
	target.dataset.stubCode = live.code;
	return {
		update: (next: CodeBlockProps) => {
			live.code = next.code;
			target.dataset.stubCode = next.code;
		},
		destroy: () => {
			target.dataset.stubCode = '';
		},
	};
}

function renderFromScratch(text: string, tailCharacters: number): string {
	const container = document.createElement('div');
	const renderer = createStreamingMarkdownRenderer({
		container,
		mountCodeBlock: mountStubCodeBlock,
	});
	renderer.update({ text, mode: 'markdown', streamingTailCharacters: tailCharacters });
	const html = container.innerHTML;
	renderer.destroy();
	return html;
}

const samples: Record<string, string> = {
	'headings and paragraphs': '# Title\n\nFirst paragraph.\n\nSecond paragraph.\n',
	'tight list': 'Intro:\n\n- one\n- two\n- three\n\nOutro.\n',
	'loose list': 'Intro:\n\n- one\n\n- two\n\n- three\n\nOutro.\n',
	'ordered list': 'Steps:\n\n1. first\n\n2. second\n\nDone.\n',
	'nested list': '- parent\n\t- child\n\t- child\n\n- sibling\n\nAfter.\n',
	'block quote': '> quoted line\n\n> still quoted\n\nPlain again.\n',
	'fenced code': 'Before.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter.\n',
	'tilde fence': 'Before.\n\n~~~py\nx = 1\n\ny = 2\n~~~\n\nAfter.\n',
	'indented code': 'Before:\n\n    indented code\n\n    more code\n\nAfter.\n',
	table: 'Data:\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nAfter.\n',
	'thematic break': 'Above.\n\n---\n\nBelow.\n',
	'html block': 'Text.\n\n<div>raw</div>\n\nMore text.\n',
	'link reference': 'See [docs][d].\n\n[d]: https://example.com\n\nEnd.\n',
	'trailing blank lines': 'Only paragraph.\n\n\n',
	'leading blank lines': '\n\nStarts late.\n',
	'no trailing newline': 'One.\n\nTwo.',
	empty: '',
};

describe('incremental markdown segmentation fidelity', () => {
	for (const [name, source] of Object.entries(samples)) {
		it(`reassembles ${name} exactly`, () => {
			expect(splitMarkdownChunks(source).join('')).toBe(source);
		});

		it(`renders ${name} identically block by block`, () => {
			const perChunk = splitMarkdownChunks(source)
				.map((chunk) => renderSanitizedHtml(chunk, 'markdown'))
				.join('');
			expect(perChunk).toBe(renderSanitizedHtml(source, 'markdown'));
		});

		it(`renders ${name} identically block by block in plain mode`, () => {
			const perChunk = splitMarkdownChunks(source)
				.map((chunk) => renderSanitizedHtml(chunk, 'plain'))
				.join('');
			expect(perChunk).toBe(renderSanitizedHtml(source, 'plain'));
		});
	}

	it('never splits inside a still-open code fence', () => {
		const streaming = 'Intro.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n';
		const chunks = splitMarkdownChunks(streaming);
		expect(chunks).toHaveLength(2);
		expect(chunks[1]?.startsWith('```ts')).toBe(true);
	});

	it('keeps a document with a link reference definition in one block', () => {
		expect(splitMarkdownChunks('a\n\n[d]: https://example.com\n\nb\n')).toHaveLength(1);
	});
});

describe('incremental streaming patch fidelity', () => {
	for (const [name, source] of Object.entries(samples)) {
		if (!source) continue;

		it.each([0, 12])(
			`streams ${name} to an identical DOM with tail %i`,
			(tailCharacters: number) => {
				const container = document.createElement('div');
				document.body.append(container);
				const renderer = createStreamingMarkdownRenderer({
					container,
					mountCodeBlock: mountStubCodeBlock,
				});

				for (let cursor = 1; cursor <= source.length; cursor += 1) {
					const prefix = source.slice(0, cursor);
					const tail = Math.min(tailCharacters, cursor);
					renderer.update({ text: prefix, mode: 'markdown', streamingTailCharacters: tail });
					expect(container.innerHTML, `at ${cursor} of ${source.length}`).toBe(
						renderFromScratch(prefix, tail),
					);
				}

				renderer.destroy();
				container.remove();
			},
		);
	}

	it('keeps settled nodes and their text nodes alive while the block grows', () => {
		const container = document.createElement('div');
		const renderer = createStreamingMarkdownRenderer({
			container,
			mountCodeBlock: mountStubCodeBlock,
		});

		renderer.update({ text: 'Hello', mode: 'markdown', streamingTailCharacters: 5 });
		const paragraph = container.firstElementChild;
		expect(paragraph?.tagName).toBe('P');

		for (const text of ['Hello there', 'Hello there, world', 'Hello there, world and more']) {
			renderer.update({ text, mode: 'markdown', streamingTailCharacters: 6 });
			expect(container.firstElementChild).toBe(paragraph);
		}
		expect(container.textContent?.trim()).toBe('Hello there, world and more');
		renderer.destroy();
	});

	it('leaves no reveal spans behind once the stream moves past a block', () => {
		const container = document.createElement('div');
		const renderer = createStreamingMarkdownRenderer({
			container,
			mountCodeBlock: mountStubCodeBlock,
		});

		renderer.update({ text: 'First block.', mode: 'markdown', streamingTailCharacters: 12 });
		expect(container.querySelectorAll('.markdown-stream-token').length).toBeGreaterThan(0);

		renderer.update({
			text: 'First block.\n\nSecond block.',
			mode: 'markdown',
			streamingTailCharacters: 13,
		});
		const settled = container.firstElementChild;
		expect(settled?.querySelectorAll('.markdown-stream-token')).toHaveLength(0);
		expect(settled?.textContent).toBe('First block.');
		renderer.destroy();
	});

	it('keeps one code-block mount while its fence is still streaming', () => {
		const container = document.createElement('div');
		const mounts: HTMLElement[] = [];
		const renderer = createStreamingMarkdownRenderer({
			container,
			mountCodeBlock: (target, props) => {
				mounts.push(target);
				return mountStubCodeBlock(target, props);
			},
		});

		let fence = 'Intro.\n\n```ts\n';
		renderer.update({ text: fence, mode: 'markdown', streamingTailCharacters: 0 });
		expect(mounts).toHaveLength(1);

		for (let line = 0; line < 6; line += 1) {
			fence += `const value${line} = ${line};\n`;
			renderer.update({ text: fence, mode: 'markdown', streamingTailCharacters: 0 });
		}

		expect(mounts).toHaveLength(1);
		const mount = mounts[0];
		if (!mount) throw new Error('expected a mounted code block');
		expect(container.contains(mount)).toBe(true);
		expect(mount.dataset.stubCode).toContain('const value5 = 5;');
		renderer.destroy();
	});
});
