import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tabs = readFileSync(new URL('./ChatTabs.svelte', import.meta.url), 'utf8');
const strip = readFileSync(new URL('./ChatChangedFiles.svelte', import.meta.url), 'utf8');
const surface = readFileSync(new URL('./ChatSurface.svelte', import.meta.url), 'utf8');
const changesService = readFileSync(
	new URL('../infrastructure/services/chat-session-changes.service.ts', import.meta.url),
	'utf8',
);
describe('per-chat changed files surface', () => {
	it('removes the workstream-wide control from the chat tab row', () => {
		expect(tabs).not.toContain('active-workstream-change-totals');
		expect(tabs).not.toContain('WorkstreamChangeTotals');
		expect(tabs).not.toContain('onopenfiles');
	});

	it('places a compact expandable exact-path list directly above the composer', () => {
		expect(strip).toContain('data-testid="chat-changed-files-toggle"');
		expect(strip).toContain('data-testid="chat-changed-file"');
		expect(strip).toContain('{file.path}');
		expect(strip).not.toMatch(/Undo|Keep|Review/u);
		expect(surface.indexOf('<ChatChangedFiles')).toBeGreaterThan(-1);
		expect(surface.indexOf('<ChatChangedFiles')).toBeLessThan(surface.indexOf('<ChatComposer'));
	});

	it('scrolls the path list through the shared overlay scrollbar', () => {
		expect(strip).toContain('<ScrollableDiv');
		expect(strip).not.toMatch(/class="[^"]*overflow-y-auto/u);
		expect(strip).not.toMatch(/class="[^"]*styled-scrollbar/u);
	});

	it('keeps the path list mounted and self-measuring so the footer reserves its height', () => {
		expect(strip).toContain('data-testid="chat-changed-files-drawer"');
		expect(strip).toContain('bind:clientHeight={listHeight}');
	});

	it('revalidates the chat snapshot in place without showing the revalidation', () => {
		expect(surface).not.toContain('sessionChanges = null;');
		expect(surface).not.toContain('sessionChangesRefreshing');
		expect(strip).not.toContain('data-refreshing');
	});

	it('watches the chat changes for as long as the chat surface is mounted', () => {
		expect(surface).toContain('const releaseSessionChanges = watchSessionChangesHook();');
		expect(surface).toContain('releaseSessionChanges();');
	});

	it('loads and opens through the application query and command boundary', () => {
		expect(changesService).toContain('new LatestAgentSessionChangesQuery(sessionChangesPort)');
		expect(changesService).toContain('new OpenAgentSessionChangedFileCommand(');
		expect(changesService).toContain('new AgentSessionFileDiffExtensionTarget()');
		expect(surface).toContain('openChangedFileCommand({');
		expect(surface).not.toContain('getSessionChanges(');
		expect(surface).not.toContain('getSessionChangePatch(');
		expect(surface).not.toContain('AgentSessionFileDiffExtensionTarget');
		expect(surface).not.toContain('getRunChangePatch({');
	});
});
