import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sidebar = readFileSync(new URL('./Sidebar.svelte', import.meta.url), 'utf8');
const chatSurface = readFileSync(
	new URL('../../chat/presentation/ChatSurface.svelte', import.meta.url),
	'utf8',
);
const sessionActivation = readFileSync(
	new URL('../../chat/infrastructure/services/session-activation.service.ts', import.meta.url),
	'utf8',
);
const workstreamsLayout = readFileSync(
	new URL('./layouts/WorkstreamsLayout.svelte', import.meta.url),
	'utf8',
);

describe('sidebar navigation contract', () => {
	it('selects the pending workstream without covering cached content', () => {
		expect(workstreamsLayout).toContain("import { navigating, page } from '$shared/router/state';");
		expect(workstreamsLayout).toContain(
			'const openingWorkstream = $derived(openingWorkstreamId(navigating.to, activeWorkstreamId));',
		);
		expect(workstreamsLayout).toContain('{activeWorkstreamId}');
		expect(workstreamsLayout).not.toContain('NAVIGATION_LOADING_REVEAL_DELAY_MS');
		expect(workstreamsLayout).not.toContain('workstreamStatusVisible');
		expect(workstreamsLayout).not.toContain('data-testid="workstream-navigation-loader"');
		expect(workstreamsLayout).not.toContain('data-navigation-loading="true"');
		expect(workstreamsLayout).toContain('<div class="contents">');
		expect(workstreamsLayout).toContain('{@render children()}');
		expect(workstreamsLayout).not.toContain('workstream-navigation-preview');
		expect(workstreamsLayout).not.toContain('PaneLoadingSkeleton');
		expect(sidebar).toContain('href={rowHref(workstream.id, targetSessionId)}');
		expect(sidebar).toContain('const pendingWorkstreamId = $derived(');
		expect(sidebar).toContain(
			'const visuallyActiveWorkstreamId = $derived(pendingWorkstreamId ?? activeWorkstreamId);',
		);
		expect(sidebar).toContain('aria-current={workstream.id === activeWorkstreamId');
		expect(sidebar).toContain('aria-busy={workstream.id === pendingWorkstreamId || undefined}');
		expect(sidebar).toContain('data-navigation-pending={workstream.id === pendingWorkstreamId');
		expect(sidebar).toContain('isSelected');
		expect(sidebar).not.toContain('navigationPaintHandoff');
		const mint = sessionActivation.slice(sessionActivation.indexOf('async mint('));
		expect(mint.indexOf('chatSessionStore.suppressRouteActivation = true;')).toBeGreaterThan(-1);
		expect(mint.indexOf('chatSessionStore.suppressRouteActivation = true;')).toBeLessThan(
			mint.indexOf('await chatRouteSync.syncSessionUrl(sessionId, workstreamId);'),
		);
		expect(chatSurface).toContain('onclosefresh={closeFreshChatCommand}');
		expect(sidebar).toContain("pullRequestStateByWorkstream[workstream.id] ?? 'unknown'");
	});

	it('hands archive to the repositories command together with the extension announcement', () => {
		expect(workstreamsLayout).toContain(
			'archiveWorkstreamCommand(workstream, announceWorkstreamLifecycleCommand)',
		);
		expect(workstreamsLayout).not.toContain('retireWorkstream');
		expect(workstreamsLayout).not.toContain('toast.');
		expect(sidebar).not.toContain('archivingWorkstreamId');
	});
});
