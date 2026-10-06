import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const rail = readFileSync(new URL('./ExtensionGutterRail.svelte', import.meta.url), 'utf8');
const gutter = readFileSync(new URL('./ExtensionGutter.svelte', import.meta.url), 'utf8');
const shell = readFileSync(new URL('./ExtensionInspectorShell.svelte', import.meta.url), 'utf8');
const store = readFileSync(
	new URL('../../shared/extensions/inspector-gutter.store.svelte.ts', import.meta.url),
	'utf8',
);
const transcript = readFileSync(
	new URL('../../chat/presentation/ChatSurface.svelte', import.meta.url),
	'utf8',
);

const desktopSrc = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/u, '');

function sourceFiles(directory: string): string[] {
	return readdirSync(directory).flatMap((entry) => {
		const path = `${directory}/${entry}`;
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return /\.(?:svelte|ts)$/u.test(path) ? [path] : [];
	});
}

describe('extensions rail contract', () => {
	it('draws the resting list inside the transcript rather than beside it', () => {
		expect(transcript).toMatch(
			/import \{[^}]*\bExtensionGutterRail\b[^}]*\} from '\$lib\/extensions\/extensions\.api'/u,
		);
		expect(transcript).toContain('<ExtensionGutterRail {workstreamId} />');
		expect(rail).toContain('{#if !drawerOpen}');
	});

	it('keeps one source for the room the rail occupies', () => {
		expect(transcript).toContain(
			"import { EXTENSION_GUTTER_WIDTH } from '$shared/extensions/inspector-gutter-row'",
		);
		expect(gutter).not.toContain('EXTENSION_GUTTER_WIDTH');
	});

	it('builds the rail from the projection the inspector already renders', () => {
		expect(shell).toContain(
			"import { inspectorGutter } from '$shared/extensions/inspector-gutter.store.svelte'",
		);
		expect(shell).toContain('panels: () => orderedPanels,');
		expect(shell).toContain('hiddenPanelIds: () => presentedPreferences.hidden,');
		expect(shell).toContain('interactive: () => inspectorInteractive,');
		expect(rail).toContain(
			'const disabled = $derived(!inspectorGutter.isInteractive(workstreamId))',
		);
		expect(rail).toContain(
			'const workstreamName = $derived(inspectorGutter.workstreamNameFor(workstreamId))',
		);
	});

	it('hands the rail accessors, never a copy an effect has to keep in step', () => {
		expect(shell).toContain('const gutterSource = {');
		expect(shell).not.toContain('inspectorGutter.publish');
		expect(store).not.toContain('publish(');
		expect(shell).toMatch(/\$effect\(\(\) => inspectorGutter\.connect\(gutterSource\)\)/u);
		expect(store.slice(store.indexOf('#for(workstreamId'))).not.toContain('this.#source =');
	});

	it('keeps gutterRows the only thing that builds the list', () => {
		expect(store).toContain('return gutterRows({');

		const callers = sourceFiles(desktopSrc)
			.filter((path) => !path.endsWith('.test.ts'))
			.filter((path) => /\bgutterRows\(/u.test(readFileSync(path, 'utf8')))
			.map((path) => path.slice(desktopSrc.length + 1));

		expect(callers).toEqual([
			'lib/shared/extensions/inspector-gutter-row.ts',
			'lib/shared/extensions/inspector-gutter.store.svelte.ts',
		]);
	});
});
