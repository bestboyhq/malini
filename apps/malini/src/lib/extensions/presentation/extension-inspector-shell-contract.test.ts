import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./ExtensionInspectorShell.svelte', import.meta.url), 'utf8');
const gutterSource = readFileSync(new URL('./ExtensionGutter.svelte', import.meta.url), 'utf8');

describe('ExtensionInspectorShell contract', () => {
	it('stays registry-driven and renders every visible panel as a full-label browser tab', () => {
		expect(source).toContain('panels: readonly ExtensionPanelRegistration[]');
		expect(source).toContain('{@render renderIcon(panel.icon, 14)}');
		expect(source).toContain("'data-testid': 'extension-inspector-tab-close'");
		expect(source).toContain('closeLabel={`Close ${panel.label}`}');
		expect(source).not.toMatch(/\b(?:Terminal|Preview|Files|Changes|Checks)\b/u);
	});

	it('hosts panels only through the public extension mount contract', () => {
		expect(source).toContain("from '@malini/extension-api'");
		expect(source).toContain('<ExtensionPanelHost');
		expect(source).toContain('panel={mountedPanel}');
		expect(source).toContain('context={entry.context}');
		expect(source).toContain('workstreamId={entry.workstreamId}');
		expect(source).toContain('notifyPanelOpened(panel, panelContext, key)');
		expect(source).toContain('panel.onDidOpen?.(panelContext)');
	});

	it('opens panels from a plus menu and keeps Extensions as a closeable browser tab', () => {
		expect(source).toContain('addExtensionsHref?: string');
		expect(source).toContain('addExtensionsActive?: boolean');
		expect(source).toContain('addExtensionsContent?: Snippet');
		expect(source).toContain('data-testid="extension-inspector-add"');
		expect(source).toContain('testId="extension-inspector-panel-picker"');
		expect(source).toContain('data-testid="extension-inspector-picker-item"');
		expect(source).toContain('data-testid="add-extension-panel-option"');
		expect(source).toContain("'data-testid': 'add-extension-panel'");
		expect(source).toContain('label="Extensions"');
		expect(source).toContain('<Icon name="grid-plus"');
		expect(source).toContain('{@render addExtensionsContent()}');
		expect(source).toContain('data-panel-id="extension-directory"');
		expect(source).toContain('{#if addExtensionsHref && directoryTabOpen}');
		expect(source).toContain('selected={addExtensionsActive}');
		expect(source).toContain('rememberDirectoryTabOpen(false)');
		expect(source).toContain('loadInspectorDirectoryTabOpen(workstreamId, storage)');
		expect(source).toContain('saveInspectorDirectoryTabOpen(workstreamId, open, storage)');
	});

	it('lazily keeps every selected extension host alive across panel and directory switches', () => {
		expect(source).not.toContain('{#key activePanel.id}');
		expect(source.match(/<ExtensionPanelHost/gu)).toHaveLength(1);
		expect(source).toContain('inert={!isActive}');
		expect(source).toContain('data-inspector-panel-cache');
		expect(source).toContain('data-panel-id={mountedPanel.id}');
		expect(source).toContain('reconcileInspectorPanelKeepAlive(keepAlive');
		expect(source).toContain('allowActivePanelMount: !addExtensionsActive');
		expect(source).toContain(
			'entry.panels.map(({ id }) => panelFailureKey(entry.workstreamId, id))',
		);
	});

	it('marks a panel ready only after its host mount and exposes exact terminal errors', () => {
		expect(source).toContain('data-navigation-workstream-id={entry.workstreamId}');
		expect(source).toContain('data-navigation-panel-id={mountedPanel.id}');
		expect(source).toContain('data-navigation-error="true"');
		expect(source).toContain('data-navigation-error-message={failure}');

		const hostSource = readFileSync(
			new URL('./ExtensionPanelHost.svelte', import.meta.url),
			'utf8',
		);
		expect(hostSource).toContain('controller.isMounted(renderTarget, renderPanel)');
		expect(hostSource).toContain("data-navigation-ready={renderState === 'ready'");
		expect(hostSource).toContain("data-navigation-error={renderState === 'error'");
		expect(
			hostSource.indexOf('controller.render(renderTarget, renderPanel, renderContext).then'),
		).toBeLessThan(hostSource.indexOf("renderState = 'ready'"));
		expect(hostSource).not.toContain('requestAnimationFrame');
		expect(hostSource).toContain('if (!renderTarget) return;');
	});

	it('retains a cached panel failure until the panel is closed and safely remounted', () => {
		const openPanel = source.slice(
			source.indexOf('function openPanel('),
			source.indexOf('async function focusPanelTab('),
		);
		expect(openPanel).not.toContain('clearPanelFailure');
		expect(source).toContain('clearPanelFailure(panelId);\n\t\tnotifyPanelClosed(closingPanel)');
		expect(source).toContain(
			'Object.entries(panelFailures).filter(([key]) => retainedPanelKeys.has(key))',
		);
		expect(source).not.toContain('if (!inspectorRuntimeReady) return;\n\t\tconst retainedPanelIds');
	});

	it('closes a visible tab onto its adjacent tab and can reopen hidden panels', () => {
		expect(source).toContain('visiblePanels[closingIndex + 1] ?? visiblePanels[closingIndex - 1]');
		expect(source).toContain('setInspectorPanelVisible(current, panelId, false)');
		expect(source).toContain('setInspectorPanelVisible(current, panelId, true)');
		expect(source).toContain('updated = selectInspectorPanel(updated, adjacentPanel.id)');
		expect(source).toContain('const closingPanel = visiblePanels[closingIndex]');
		expect(source).toContain('notifyPanelClosed(closingPanel)');
		expect(source).toContain('panel.onDidClose?.()');
	});

	it('keeps tab chrome and only the destination workstream panel visible during hydration', () => {
		expect(source).toContain(
			'const inspectorInteractive = $derived(loadedWorkstreamId === workstreamId)',
		);
		expect(source).toContain(
			'const inspectorRuntimeReady = $derived(ready && inspectorInteractive)',
		);
		expect(source).not.toContain('if (!ready) return');
		expect(source).toContain('if (!inspectorInteractive) return preferences');
		expect(source).toContain('disabled={!inspectorInteractive}');
		expect(source).toContain('{:else if !inspectorRuntimeReady && !presentsMountedPanel}');
		expect(source).toContain(
			'isPresented && (inspectorRuntimeReady || rendersContextWorkstream(mountedPanel))',
		);
		expect(source).not.toContain('inspector-runtime-loader');
		expect(source).not.toContain('data-navigation-loading="true"');
	});

	it('captures native pointer and keyboard panel switches with registry location identities', () => {
		expect(source.match(/data-navigation-local-target'?[=:]/gu)).toHaveLength(4);
		expect(source.match(/data-navigation-target-workstream-id'?[=:]/gu)).toHaveLength(4);
		expect(source.match(/data-navigation-panel-id'?[=:]/gu)?.length ?? 0).toBeGreaterThanOrEqual(4);
		expect(source.match(/'extension-inspector-panel'/gu)).toHaveLength(4);
		expect(source).toContain('onselect={() => selectPanel(panel.id)}');
		expect(source).toContain('onclick={() => openPanel(panel.id)}');
		expect(source).toContain("'data-navigation-panel-id': adjacentPanelId ?? undefined");
		expect(source).toContain('onclose={(event) => closePanel(event, panel.id)}');
		expect(source).toContain('visiblePanels.find((candidate) => candidate.id !== panel.id)?.id');
		expect(source).toContain('data-navigation-panel-id={hideActiveTargetPanelId ?? undefined}');
		expect(source).toContain(
			'data-navigation-path-id="expected-path:extension-inspector.hide-active-panel"',
		);
	});

	it('keeps directory switches route-captured and exposes semantic active destinations', () => {
		const directoryTab = source.slice(
			source.lastIndexOf('<BrowserTab', source.indexOf("'data-testid': 'add-extension-panel'")),
			source.indexOf('</BrowserTab>', source.indexOf("'data-testid': 'add-extension-panel'")),
		);

		expect(directoryTab).toContain('href={addExtensionsHref}');
		expect(directoryTab).toContain('selected={addExtensionsActive}');
		expect(directoryTab).not.toContain('data-navigation-local-target');
		expect(directoryTab).toContain(
			"'data-navigation-path-id': 'expected-path:extension-directory.open'",
		);
		expect(source).toContain("'data-navigation-target': closeDirectoryNavigationTarget");
		expect(source).toContain(
			"'data-navigation-path-id': 'expected-path:extension-directory.close'",
		);
		expect(source).toContain(
			"data-testid={isPresented ? 'extension-inspector-content' : undefined}",
		);
		expect(source).toContain('data-panel-id={mountedPanel.id}');
		expect(source).toContain('data-panel-id="extension-directory"');
	});

	it('has a real open/closed state that starts open and reads from one store', () => {
		expect(source).toContain(
			"import { inspectorDrawer } from '$shared/extensions/inspector-drawer.store.svelte'",
		);
		expect(source).toContain(
			'const drawerOpen = $derived(inspectorDrawer.isOpen(workstreamId, storage))',
		);
		expect(source).toContain('data-inspector-drawer-open={drawerOpen}');
		expect(source).toContain('{#if drawerOpen}');
	});

	it('draws compact, open and floating from one section, so the panel cache never remounts', () => {
		expect(source.match(/<section/gu)).toHaveLength(1);
		expect(source).not.toContain('<svelte:element');
	});

	it('offers a labeled control in both directions', () => {
		expect(gutterSource).toContain('data-testid="extension-inspector-show"');
		expect(gutterSource).toContain('ariaLabel="Show inspector"');
		expect(gutterSource).toContain('content="Show inspector"');
		expect(gutterSource).toContain('onclick={onshow}');
		expect(source).toContain('onshow={openDrawer}');
		expect(source).toContain('data-testid="extension-inspector-hide"');
		expect(source).toContain('ariaLabel="Hide inspector"');
		expect(source).toContain('content="Hide inspector"');
		expect(source).toContain('onclick={closeDrawer}');
	});

	it('makes every panel reachable from the closed state, not just the one already open', () => {
		expect(source).toContain('<ExtensionGutter');
		expect(source).toContain('rows={compactRows}');
		expect(source).toContain('onopen={openPanel}');
		expect(gutterSource).toContain('onclick={() => onopen(row.panelId)}');
		expect(gutterSource).toContain(
			'data-navigation-path-id="expected-path:extension-inspector.open-panel"',
		);
	});

	it('opens the drawer only for an explicit request to show a panel', () => {
		const openPanel = source.slice(
			source.indexOf('function openPanel('),
			source.indexOf('async function focusPanelTab('),
		);
		expect(openPanel).toContain('openDrawer()');

		expect(source).toContain('handledRequestedPanelId = requested;\n\t\topenPanel(requested)');
		expect(source).toContain('openPanel(request.panelId);\n\t\tinspectorPanelCommands.consume(');
		expect(source.match(/openDrawer\(\)/gu)).toHaveLength(3);
	});

	it('never writes a preference the user did not choose', () => {
		const finalize = source.slice(
			source.indexOf('if (finalizedWorkstreamId !== workstreamId) {'),
			source.indexOf('function replayPendingMutations('),
		);
		expect(finalize).not.toContain('saveInspectorPanelPreferences');
		expect(source.match(/saveInspectorPanelPreferences\(/gu)).toHaveLength(1);
		expect(source).toContain(
			'if (finalizedWorkstreamId === workstreamId) {\n\t\t\tsaveInspectorPanelPreferences(workstreamId, next, storage);',
		);
	});

	it('does not pin the Extensions tab just because a link landed on the route', () => {
		expect(source).not.toContain('observedDirectoryRouteWorkstreamId');
		expect(source).toContain('if (!addExtensionsActive) return;\n\t\topenDrawer();');
		expect(source.match(/rememberDirectoryTabOpen\(true\)/gu)).toHaveLength(1);
		expect(source).toContain('rememberDirectoryTabOpen(false)');
	});
});
