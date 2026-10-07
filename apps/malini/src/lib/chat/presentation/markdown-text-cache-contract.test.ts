import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const markdown = readFileSync(new URL('./MarkdownText.svelte', import.meta.url), 'utf8');

function segmentHtmlSource(): string {
	const start = markdown.indexOf('\tfunction segmentHtml(');
	const end = markdown.indexOf('\n\t}', start);
	expect(start).toBeGreaterThan(-1);
	expect(end).toBeGreaterThan(start);
	return markdown.slice(start, end);
}

describe('MarkdownText sanitized HTML cache contract', () => {
	it('stores only post-sanitization HTML for non-streaming renders', () => {
		const sanitizeStart = markdown.indexOf('export function renderSanitizedHtml');
		const sanitizeEnd = markdown.indexOf('\n\tfunction decorateStreamingTail', sanitizeStart);
		const sanitize = markdown.slice(sanitizeStart, sanitizeEnd);
		expect(sanitize).toContain('DOMPurify.sanitize(rawHtml)');

		const render = segmentHtmlSource();
		expect(render.replace(/\s+/gu, ' ')).toContain(
			'const sanitized = maskSensitiveHtml( linkifyFileMentions(holdWorkstreamImages(renderSanitizedHtml(chunkSource, mode))), );',
		);
		expect(render).toContain('sanitizedMarkdownHtmlCache.set(cacheKey, sanitized);');
	});

	it('rewrites file mentions with nothing but the sanitized HTML of the block', () => {
		const render = segmentHtmlSource();
		expect(render.match(/linkifyFileMentions\(/gu)).toHaveLength(2);
		expect(
			render.match(
				/linkifyFileMentions\(holdWorkstreamImages\(renderSanitizedHtml\(chunkSource, mode\)\)\)/gu,
			),
		).toHaveLength(2);
		expect(markdown).toContain("import { linkifyFileMentions } from './file-mention-links';");
	});

	it('configures markdown parsing without a per-instance global mutation', () => {
		expect(markdown).not.toContain('marked.setOptions(');
		expect(markdown).toContain(
			"marked.parse(source, { async: false, breaks: renderMode !== 'prose', gfm: true })",
		);
	});

	it('bypasses both cache reads and writes for streaming tails', () => {
		const render = segmentHtmlSource();
		const streamingStart = render.indexOf('if (tailCharacters > 0)');
		const cacheKeyStart = render.indexOf('const cacheKey = sanitizedMarkdownHtmlCacheKey');
		const streamingBranch = render.slice(streamingStart, cacheKeyStart);

		expect(streamingStart).toBeGreaterThan(-1);
		expect(cacheKeyStart).toBeGreaterThan(streamingStart);
		expect(streamingBranch).toContain('decorateStreamingTail(');
		expect(streamingBranch).toContain('renderSanitizedHtml(chunkSource, mode)');
		expect(streamingBranch).not.toContain('sanitizedMarkdownHtmlCache.');
	});

	it('renders growing and settled documents through one root element', () => {
		expect(markdown).not.toContain('{@html html}');
		expect(markdown).not.toContain('use:managedCodeBlocks');
		expect(markdown.match(/data-testid="markdown-text"/gu)).toHaveLength(1);
		expect(markdown.replace(/\s+/gu, ' ')).toContain(
			'use:streamingMarkdown={{ text, mode, streamingTailCharacters, canOpenFile: canopenfile, imageSource: imagesrc, }}',
		);
	});
});
