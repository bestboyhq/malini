import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./ExtensionDirectoryPage.svelte', import.meta.url), 'utf8');
const detail = readFileSync(
	new URL('./ExtensionDirectoryDetailPage.svelte', import.meta.url),
	'utf8',
);
const inspector = readFileSync(
	new URL('./ExtensionInspectorShell.svelte', import.meta.url),
	'utf8',
);

describe('ExtensionDirectoryPage performance contract', () => {
	it('renders the static bundled catalog on its first frame with no registry round trip', () => {
		expect(source).toContain(
			"import { bundledExtensionDirectoryEntries } from './extension-directory-catalog'",
		);
		expect(source).toContain(
			'const entries: readonly ExtensionDirectoryEntry[] = bundledExtensionDirectoryEntries',
		);
		expect(source).toContain('searchExtensionDirectory(entries, query)');
		expect(source).toContain('data-navigation-ready="true"');
		expect(source).not.toContain('Loading extension directory');
		expect(source).not.toContain('RegistryClient');
		expect(source).not.toContain('.load()');
	});

	it('does not hold an always-available detail open on irrelevant repository configuration', () => {
		expect(detail).toContain(
			'bundledExtensionDirectoryEntries.find(({ id }) => id === extensionId) ?? null',
		);
		expect(detail).not.toContain('RegistryClient');
		expect(detail).toContain(
			'loadExtensionRepositoryEnablementCommand(targetWorkstreamId, targetExtensionId);',
		);
		expect(detail).toContain(
			'data-navigation-ready={!needsRepositoryEnablement ||\n\t(!repositoryStateLoading && !repositoryStateError)',
		);
		expect(detail).toContain(
			'data-navigation-pending={needsRepositoryEnablement && repositoryStateLoading',
		);
	});

	it('keeps cached content in place without pointerdown loader previews', () => {
		for (const component of [source, detail]) {
			expect(component).not.toContain('import { flushSync');
			expect(component).not.toContain('animate-pulse');
			expect(component).not.toContain('data-navigation-loading');
		}
		expect(source).not.toContain('extension-directory-detail-preview');
		expect(detail).not.toContain('extension-directory-preview');
		expect(source).not.toContain('previewDetailFromPointer');
		expect(detail).not.toContain('previewDirectoryFromPointer');
		expect(source).not.toContain('showDetailPreview');
		expect(detail).not.toContain('showDirectoryPreview');
	});

	it('keeps the inspector content wrapper mounted while directory and detail content swap', () => {
		expect(inspector).not.toContain('{#key addExtensionsContentKey}');
	});

	it('swaps inspector panels without motion', () => {
		expect(inspector).not.toContain('animateInspectorPanelSwap');
		expect(inspector).not.toContain('animatePanelSelection');
		expect(inspector).not.toContain('node.animate(');
	});

	it('uses shallow history for query-only directory/detail swaps', () => {
		for (const component of [source, detail]) {
			expect(component).toContain("import { pushState } from '$shared/router/navigation'");
			expect(component).toContain(
				"import { recordShallowHistoryCommit } from '$shared/router/history-ledger'",
			);
			expect(component).toContain("recordShallowHistoryCommit('push');");
			expect(component).toContain('data-navigation-shallow="true"');
			expect(component).toContain('event.preventDefault();');
			expect(component).toContain('extensionDirectory: { workstreamId, extensionId');
		}
		expect(source).toContain('onclick={(event) => openDetailShallow(event, entry.id)}');
		expect(detail).toContain('onclick={openDirectoryShallow}');
		expect(source).toContain('headingElement?.focus({ preventScroll: true })');
		expect(detail).toContain('detailHeadingElement?.focus({ preventScroll: true })');
	});
});
