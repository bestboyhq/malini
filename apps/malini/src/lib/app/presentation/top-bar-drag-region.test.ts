import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stripComments = (source: string): string =>
	source.replace(/<!--[\s\S]*?-->/gu, '').replace(/\/\*[\s\S]*?\*\//gu, '');

const read = (file: string): string =>
	stripComments(readFileSync(new URL(file, import.meta.url), 'utf8'));

const shell = {
	TopBar: read('./TopBar.svelte'),
	SidebarFrame: read('./SidebarFrame.svelte'),
	AppShell: read('./AppShell.svelte'),
};

const markupOf = (source: string): string =>
	source.slice(source.indexOf('</script>'), source.indexOf('<style>'));

function occurrences(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

describe('the shell drag region', () => {
	it('is the top bar root nav', () => {
		const nav = /<nav\s+class="global-topbar"[^>]*>/u.exec(markupOf(shell.TopBar))?.[0];
		expect(nav, 'the root <nav class="global-topbar"> is in the bar').toBeDefined();
		expect(nav).toContain('data-native-drag-region');
	});

	it('is declared exactly once in the top bar', () => {
		expect(occurrences(markupOf(shell.TopBar), 'data-native-drag-region')).toBe(1);
	});

	it.each(['SidebarFrame', 'AppShell'] as const)(
		'is never declared again in %s, which mounts after the bar controls',
		(component) => {
			expect(shell[component]).not.toContain('data-native-drag-region');
		},
	);

	it('leaves the controls to the global descendant rule', () => {
		expect(shell.TopBar).not.toContain('-webkit-app-region');
		const base = read('../../../renderer/src/styles/base.css');
		expect(base).toMatch(
			/\[data-native-drag-region\]\s*:is\([\s\S]*?\bbutton\b[\s\S]*?\)\s*\{\s*-webkit-app-region:\s*no-drag/u,
		);
		expect(base).toMatch(
			/\[data-native-drag-region\]\s*:is\([\s\S]*?\ba\b[\s\S]*?\)\s*\{\s*-webkit-app-region:\s*no-drag/u,
		);
	});
});
