import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const markdown = readFileSync(new URL('./MarkdownText.svelte', import.meta.url), 'utf8');
const codeBlock = readFileSync(new URL('./MarkdownCodeBlock.svelte', import.meta.url), 'utf8');

describe('agent markdown code blocks', () => {
	it('upgrades sanitized code nodes without bypassing the markdown safety boundary', () => {
		expect(markdown).toContain('DOMPurify.sanitize(rawHtml)');
		expect(markdown).toContain("template.content.querySelectorAll('pre > code')");
		expect(markdown).toContain('safeHtml: codeElement.innerHTML');
		expect(markdown).toContain('mount(MarkdownCodeBlock');
		expect(markdown.match(/querySelectorAll\('pre > code'\)/gu)).toHaveLength(1);
		expect(markdown.match(/mount\(MarkdownCodeBlock/gu)).toHaveLength(1);
	});

	it('keeps a growing fence mounted instead of remounting it every reveal tick', () => {
		expect(markdown).toContain('update?(props: ManagedCodeBlockProps): void;');
		expect(markdown).toContain('mount(MarkdownCodeBlock, { target, props: live })');
		expect(markdown).toContain('live.safeHtml = next.safeHtml;');
		expect(markdown).toContain(
			'if (!incoming.code.trimEnd().startsWith(mounted.code.trimEnd())) return false;',
		);
	});

	it('uses the shared horizontal scroller rather than native code overflow', () => {
		expect(codeBlock).toContain('<ScrollableDiv');
		expect(codeBlock).toContain('orientation="x"');
		expect(codeBlock).toContain('testId="markdown-code-scroll"');
		expect(markdown).not.toContain('.markdown-text :global(pre) {');
	});

	it('keeps a persistent copy action backed by the copy-text command', () => {
		expect(codeBlock).toContain('data-testid="markdown-code-copy"');
		expect(codeBlock).toContain('copyTextCommand({ requestId, text: code });');
		expect(codeBlock).toContain('<Icon name="copy"');
		expect(codeBlock).toContain('<Icon name="check"');
	});
});
