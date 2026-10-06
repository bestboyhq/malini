// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: {} }));

import component from './MarkdownText.svelte?raw';
import { renderSanitizedHtml } from './MarkdownText.svelte';
import { sanitizedMarkdownHtmlCacheKey } from './sanitized-markdown-html-cache';

const MODEL_SOURCE_WRAPPED_PARAGRAPH = [
	'`ensure_staging_precondition` probes for a free port before it forks, and macOS has no atomic',
	'close-on-exec for sockets. A child spawned mid-probe inherits the descriptor and holds the port',
	'for its whole lifetime, so the next probe reports it occupied.',
].join('\n');

const HUMAN_AUTHORED_LINES = 'reproduce it first\nthen fix it\nthen show me the screenshot';

function breakCount(html: string): number {
	return html.match(/<br\s*\/?>/gu)?.length ?? 0;
}

describe('assistant prose reflows', () => {
	it('drops the model source wrapping from a paragraph', () => {
		const html = renderSanitizedHtml(MODEL_SOURCE_WRAPPED_PARAGRAPH, 'prose');
		expect(breakCount(html)).toBe(0);
		expect(html.match(/<p>/gu)).toHaveLength(1);
	});

	it('keeps the same paragraph hard-wrapped in markdown mode', () => {
		expect(breakCount(renderSanitizedHtml(MODEL_SOURCE_WRAPPED_PARAGRAPH, 'markdown'))).toBe(2);
	});

	it('still separates paragraphs on a blank line', () => {
		const html = renderSanitizedHtml('First one.\n\nSecond one.', 'prose');
		expect(html.match(/<p>/gu)).toHaveLength(2);
	});

	it('leaves block structure alone', () => {
		const html = renderSanitizedHtml('### What I measured\n\n- one\n- two', 'prose');
		expect(html).toContain('<h3>What I measured</h3>');
		expect(html.match(/<li>/gu)).toHaveLength(2);
	});

	it('pairs the parser option with a white-space override on the prose root', () => {
		expect(component).toContain(
			"\t.markdown-text[data-render-mode='prose'] :global(p) {\n\t\twhite-space: normal;\n\t}",
		);
	});
});

describe('user prompts keep their newlines verbatim', () => {
	it('preserves the newlines the writer typed', () => {
		expect(breakCount(renderSanitizedHtml(HUMAN_AUTHORED_LINES, 'markdown'))).toBe(2);
	});

	it('would have lost them under the prose seam', () => {
		expect(breakCount(renderSanitizedHtml(HUMAN_AUTHORED_LINES, 'prose'))).toBe(0);
	});

	it('is the default mode, so no existing caller changed behavior', () => {
		expect(component).toContain("mode = 'markdown',");
	});
});

describe('the sanitized HTML cache separates the two documents', () => {
	it('keys prose apart from markdown for identical source', () => {
		expect(sanitizedMarkdownHtmlCacheKey('prose', MODEL_SOURCE_WRAPPED_PARAGRAPH)).not.toBe(
			sanitizedMarkdownHtmlCacheKey('markdown', MODEL_SOURCE_WRAPPED_PARAGRAPH),
		);
	});

	it('would otherwise have served one mode the other mode HTML', () => {
		expect(renderSanitizedHtml(MODEL_SOURCE_WRAPPED_PARAGRAPH, 'prose')).not.toBe(
			renderSanitizedHtml(MODEL_SOURCE_WRAPPED_PARAGRAPH, 'markdown'),
		);
	});
});
