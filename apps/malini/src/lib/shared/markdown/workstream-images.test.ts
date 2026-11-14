// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderSanitizedHtml } from './MarkdownText.svelte';
import { holdWorkstreamImages, showWorkstreamImages } from './workstream-images';

function render(markdown: string): HTMLElement {
	const host = document.createElement('div');
	host.innerHTML = holdWorkstreamImages(renderSanitizedHtml(markdown, 'markdown'));
	return host;
}

function image(host: HTMLElement): HTMLImageElement {
	const found = host.querySelector('img');
	if (!found) throw new Error('no image rendered');
	return found;
}

describe('workstream images in transcript markdown', () => {
	it('holds a workstream-relative image back from the page and names its path', () => {
		const held = image(render('![zone](.context/my%20shot.png)'));
		expect(held.getAttribute('src')).toBeNull();
		expect(held.dataset.workstreamImage).toBe('.context/my shot.png');
		expect(held.alt).toBe('zone');
	});

	it('holds an image named by its absolute path for the workstream to resolve', () => {
		const held = image(render('![shot](/Users/someone/workstreams/ws/.context/shot.png)'));
		expect(held.getAttribute('src')).toBeNull();
		expect(held.dataset.workstreamImage).toBe('/Users/someone/workstreams/ws/.context/shot.png');
	});

	it('leaves web and data images to the page', () => {
		for (const src of [
			'https://example.com/a.png',
			'//cdn.example.com/a.png',
			'data:image/png;base64,AAAA',
		]) {
			const kept = image(render(`![x](${src})`));
			expect(kept.getAttribute('src')).toBe(src);
			expect(kept.dataset.workstreamImage).toBeUndefined();
		}
	});

	it('shows each held image once its workstream file is loaded', () => {
		const host = render('![a](shots/a.png) ![b](shots/b.png)');
		const loaded: Record<string, string> = { 'shots/a.png': 'blob:a' };
		showWorkstreamImages(host, (path) => loaded[path] ?? null);
		const [first, second] = host.querySelectorAll('img');
		expect(first?.getAttribute('src')).toBe('blob:a');
		expect(second?.getAttribute('src')).toBeNull();
	});
});
