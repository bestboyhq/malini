// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readmeFragment } from './readme-html';

function html(markdown: string, title = 'Svelte'): string {
	const holder = document.createElement('div');
	holder.append(readmeFragment(markdown, title));
	return holder.innerHTML.replace(/\n/gu, '');
}

describe('readmeFragment', () => {
	it('drops a top heading that repeats the extension name', () => {
		expect(html('# Svelte\n\nAsk any chat.')).toBe('<p>Ask any chat.</p>');
	});

	it('keeps a top heading that says something else, below the page heading', () => {
		expect(html('# Getting started\n\n## Skills')).toBe('<h3>Getting started</h3><h4>Skills</h4>');
	});

	it('never goes below h6', () => {
		expect(html('##### Deep\n\n###### Deeper')).toBe('<h6>Deep</h6><h6>Deeper</h6>');
	});

	it('strips what DOMPurify does not allow', () => {
		expect(html('<script>alert(1)</script>\n\nSafe')).toBe('<p>Safe</p>');
	});
});
