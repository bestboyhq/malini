// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: {} }));

import DOMPurify from 'dompurify';
import { marked } from 'marked';
import * as MarkdownTextModule from './MarkdownText.svelte';

type ManagedCodeBlock = { destroy(): void };
type ManagedCodeBlockMounter = (
	target: HTMLElement,
	props: { code: string; safeHtml: string },
) => ManagedCodeBlock;

type StreamingMarkdownUpdate = {
	text: string;
	mode: 'markdown' | 'plain';
	streamingTailCharacters: number;
};

type StreamingMarkdownRenderer = {
	update(update: StreamingMarkdownUpdate): void;
	destroy(): void;
};

type StreamingMarkdownRendererFactory = (options: {
	container: HTMLElement;
	mountCodeBlock: ManagedCodeBlockMounter;
}) => StreamingMarkdownRenderer;

const MAX_ANIMATED_TAIL_CHARACTERS = 160;
const MAX_STAGGER_INDEX = 10;

function baselineCloseUnclosedFence(source: string): string {
	const fenceMatches = source.match(/^ {0,3}```/gm);
	if (fenceMatches && fenceMatches.length % 2 === 1) return `${source}\n\`\`\``;
	return source;
}

function baselineRenderSanitizedHtml(source: string): string {
	return DOMPurify.sanitize(marked.parse(source, { async: false, breaks: true, gfm: true }));
}

function baselineDecorateStreamingTail(sanitized: string, sourceCharacterCount: number): string {
	const template = document.createElement('template');
	template.innerHTML = sanitized;
	const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
	const textNodes: Text[] = [];
	let totalVisibleCharacters = 0;
	while (walker.nextNode()) {
		const node = walker.currentNode;
		if (!(node instanceof Text) || node.data.length === 0) continue;
		textNodes.push(node);
		totalVisibleCharacters += node.data.length;
	}
	if (textNodes.length === 0) return sanitized;

	const animatedCharacterCount = Math.min(
		MAX_ANIMATED_TAIL_CHARACTERS,
		Math.max(1, sourceCharacterCount),
		totalVisibleCharacters,
	);
	const animatedStart = totalVisibleCharacters - animatedCharacterCount;
	let visibleCursor = 0;
	let tokenIndex = 0;

	for (const node of textNodes) {
		const nodeEnd = visibleCursor + node.data.length;
		if (nodeEnd <= animatedStart) {
			visibleCursor = nodeEnd;
			continue;
		}
		const localStart = Math.max(0, animatedStart - visibleCursor);
		const fragment = document.createDocumentFragment();
		const stablePrefix = node.data.slice(0, localStart);
		if (stablePrefix) fragment.append(document.createTextNode(stablePrefix));
		for (const part of node.data.slice(localStart).split(/(\s+)/u)) {
			if (!part) continue;
			if (/^\s+$/u.test(part)) {
				fragment.append(document.createTextNode(part));
				continue;
			}
			const token = document.createElement('span');
			token.className = 'markdown-stream-token';
			token.dataset.testid = 'streaming-tail-token';
			token.style.setProperty('--stream-order', String(Math.min(tokenIndex, MAX_STAGGER_INDEX)));
			token.textContent = part;
			fragment.append(token);
			tokenIndex += 1;
		}
		node.replaceWith(fragment);
		visibleCursor = nodeEnd;
	}
	return template.innerHTML;
}

const baselineFactory: StreamingMarkdownRendererFactory = ({ container, mountCodeBlock }) => {
	let mounted: ManagedCodeBlock[] = [];
	return {
		update({ text, streamingTailCharacters }) {
			const source = baselineCloseUnclosedFence(text);
			const sanitized = baselineRenderSanitizedHtml(source);
			container.innerHTML =
				streamingTailCharacters > 0
					? baselineDecorateStreamingTail(sanitized, streamingTailCharacters)
					: sanitized;
			for (const instance of mounted) instance.destroy();
			mounted = [];
			for (const codeElement of container.querySelectorAll('pre > code')) {
				const pre = codeElement.parentElement;
				if (!(pre instanceof HTMLPreElement)) continue;
				const target = document.createElement('div');
				pre.replaceWith(target);
				mounted.push(
					mountCodeBlock(target, {
						code: codeElement.textContent ?? '',
						safeHtml: codeElement.innerHTML,
					}),
				);
			}
		},
		destroy() {
			for (const instance of mounted) instance.destroy();
			mounted = [];
		},
	};
};

function isStreamingMarkdownRendererFactory(
	value: unknown,
): value is StreamingMarkdownRendererFactory {
	return typeof value === 'function';
}

const incrementalRenderer =
	'createStreamingMarkdownRenderer' in MarkdownTextModule
		? MarkdownTextModule.createStreamingMarkdownRenderer
		: undefined;
const usingIncrementalRenderer = isStreamingMarkdownRendererFactory(incrementalRenderer);
const createRenderer: StreamingMarkdownRendererFactory = usingIncrementalRenderer
	? incrementalRenderer
	: baselineFactory;

const DELTA_CHARACTERS = 256;
const TARGET_CHARACTERS = 50_176;
const SMALL_WINDOW: readonly [number, number] = [1_024, 2_048];
const LARGE_WINDOW: readonly [number, number] = [49_152, TARGET_CHARACTERS];

function assistantMessage(minimumLength: number): string {
	let out = '';
	let section = 0;
	while (out.length < minimumLength) {
		section += 1;
		out += `## Step ${section}\n\n`;
		out += `The agent inspected \`handler-${section}.ts\`, traced the dispatch path and proposes the change below. The surrounding context is kept intact so the diff reads cleanly.\n\n`;
		out += '```ts\n';
		for (let line = 0; line < 8; line += 1) {
			out += `export function handler${section}_${line}(input: Input): Output {\n\treturn { ok: true, id: ${line} };\n}\n`;
		}
		out += '```\n\n';
	}
	return out;
}

function median(samples: readonly number[]): number {
	const sorted = [...samples].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	const upper = sorted[middle];
	if (upper === undefined) throw new Error('median of an empty sample');
	const lower = sorted[middle - 1] ?? upper;
	return sorted.length % 2 === 1 ? upper : (lower + upper) / 2;
}

type StreamProbe = {
	smallWindowMs: number;
	largeWindowMs: number;
	firstCodeBlockStable: boolean;
	firstCodeBlockMountCount: number;
	totalMountCount: number;
};

function streamMessage(): StreamProbe {
	const container = document.createElement('div');
	document.body.append(container);

	let totalMountCount = 0;
	const mountsByCode = new Map<string, { count: number; target: HTMLElement }>();

	const mountCodeBlock: ManagedCodeBlockMounter = (target, props) => {
		totalMountCount += 1;
		const existing = mountsByCode.get(props.code);
		mountsByCode.set(props.code, { count: (existing?.count ?? 0) + 1, target });
		target.dataset.managedCodeBlock = 'true';
		return { destroy: () => undefined };
	};

	const renderer = createRenderer({ container, mountCodeBlock });
	const message = assistantMessage(TARGET_CHARACTERS);
	const smallSamples: number[] = [];
	const largeSamples: number[] = [];

	for (let cursor = 0; cursor < message.length; cursor += DELTA_CHARACTERS) {
		const next = Math.min(message.length, cursor + DELTA_CHARACTERS);
		const started = performance.now();
		renderer.update({
			text: message.slice(0, next),
			mode: 'markdown',
			streamingTailCharacters: next - cursor,
		});
		const elapsed = performance.now() - started;
		if (next >= SMALL_WINDOW[0] && next <= SMALL_WINDOW[1]) smallSamples.push(elapsed);
		if (next >= LARGE_WINDOW[0] && next <= LARGE_WINDOW[1]) largeSamples.push(elapsed);
	}

	const settledFirstBlock = [...mountsByCode.entries()].find(
		([code]) => code.includes('handler1_0(') && code.includes('handler1_7('),
	);
	const firstCodeBlockMountCount = settledFirstBlock?.[1].count ?? 0;
	const stable =
		settledFirstBlock !== undefined &&
		container.contains(settledFirstBlock[1].target) &&
		settledFirstBlock[1].target.dataset.managedCodeBlock === 'true';

	renderer.destroy();
	container.remove();

	expect(smallSamples.length).toBeGreaterThan(2);
	expect(largeSamples.length).toBeGreaterThan(2);

	return {
		smallWindowMs: median(smallSamples),
		largeWindowMs: median(largeSamples),
		firstCodeBlockStable: stable,
		firstCodeBlockMountCount,
		totalMountCount,
	};
}

describe('streaming markdown per-delta cost', () => {
	const probe = streamMessage();

	it('reports the measured per-delta cost', () => {
		console.log(
			[
				`renderer: ${usingIncrementalRenderer ? 'incremental (createStreamingMarkdownRenderer)' : 'baseline full rebuild'}`,
				`per-delta median @1KB:  ${probe.smallWindowMs.toFixed(3)} ms`,
				`per-delta median @50KB: ${probe.largeWindowMs.toFixed(3)} ms`,
				`growth factor: ${(probe.largeWindowMs / probe.smallWindowMs).toFixed(2)}x`,
				`code-block mounts: ${probe.totalMountCount} total, ${probe.firstCodeBlockMountCount} for the first block`,
			].join('\n'),
		);
		expect(probe.smallWindowMs).toBeGreaterThan(0);
	});

	it('keeps per-delta processing flat as the message grows', () => {
		expect(probe.largeWindowMs / probe.smallWindowMs).toBeLessThanOrEqual(3);
	});

	it('keeps a settled code block mounted and in place across deltas', () => {
		expect(probe.firstCodeBlockMountCount).toBe(1);
		expect(probe.firstCodeBlockStable).toBe(true);
	});
});
