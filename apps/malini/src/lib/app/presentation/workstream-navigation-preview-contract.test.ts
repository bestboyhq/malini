import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sidebar = readFileSync(new URL('./Sidebar.svelte', import.meta.url), 'utf8');
const workstreamsLayout = readFileSync(
	new URL('./layouts/WorkstreamsLayout.svelte', import.meta.url),
	'utf8',
);
const workstreamPage = readFileSync(
	new URL('./pages/WorkstreamPage.svelte', import.meta.url),
	'utf8',
);
const agentProcessDied = readFileSync(
	new URL('../../chat/application/queries/agent-process-died.query.svelte.ts', import.meta.url),
	'utf8',
);
const agentProcessDiedBanner = readFileSync(
	new URL('../../chat/presentation/AgentProcessDiedBanner.svelte', import.meta.url),
	'utf8',
);

describe('workstream instant navigation contract', () => {
	it('selects an exact workstream destination from trusted input without delaying the anchor', () => {
		expect(sidebar).toContain('href={rowHref(workstream.id, targetSessionId)}');
		expect(sidebar).toContain(
			'return workstreamHref(targetWorkstreamId, { agentSessionId: targetSessionId });',
		);
		expect(sidebar).toContain('onpointerdown={(event) =>');
		expect(sidebar).toContain(
			'previewDestinationFromPointer(event, workstream.id, targetSessionId)',
		);
		expect(sidebar).toContain('onkeydown={(event) =>');
		expect(sidebar).toContain(
			'previewDestinationFromKeyboard(event, workstream.id, targetSessionId)',
		);
		expect(sidebar).toContain('optimisticDestination = {');
		expect(sidebar).toContain(
			'const visuallyActiveWorkstreamId = $derived(pendingWorkstreamId ?? activeWorkstreamId);',
		);

		const navigationSource = sidebar.slice(
			sidebar.indexOf('function beginWorkstreamNavigation('),
			sidebar.indexOf('onDestroy(() => {'),
		);
		expect(navigationSource).toContain(
			'previewWorkstreamDestination(targetWorkstreamId, targetSessionId);',
		);
		expect(navigationSource).toContain('runtimeDiagnostics.beginNavigation(');
		expect(navigationSource).not.toContain('event.preventDefault()');
		expect(navigationSource).not.toContain('goto(');
		expect(navigationSource).not.toContain('await ');
		expect(sidebar).not.toContain('navigationPaintHandoff');
		expect(sidebar).not.toContain('data-navigation-handler="component"');
	});

	it('cleans abandoned optimistic selection without clearing an active navigation', () => {
		expect(sidebar).toContain('scheduleAbandonedDestinationPreviewCleanup');
		expect(sidebar).toContain('if (activeNavigationTarget === target) return;');
		expect(sidebar).toContain('onpointercancel={() =>');
		expect(sidebar).toContain('onpointerleave={() =>');
		expect(sidebar).toContain('ondragstart={() =>');
		expect(sidebar).toContain('onblur={() =>');
		expect(sidebar).toContain(
			"globalThis.addEventListener('blur', abandonUnclaimedDestinationPreview)",
		);
		expect(sidebar).toContain('afterNavigate(() => {');
		expect(sidebar).toContain('optimisticDestination = null;');
		expect(sidebar).toContain('activeNavigationHandle?.cancel();');
	});

	it('keeps destination content mounted and hydrates without visible loading UI', () => {
		expect(workstreamsLayout).toMatch(/<div class="contents">\s*\{@render children\(\)\}/u);
		expect(workstreamsLayout).toContain('aria-busy={openingWorkstream !== null}');
		expect(workstreamsLayout).not.toContain('workstreamStatusVisible');
		expect(workstreamsLayout).not.toContain('data-testid="workstream-navigation-loader"');
		expect(workstreamsLayout).not.toContain('NAVIGATION_LOADING_REVEAL_DELAY_MS');
		expect(workstreamsLayout).not.toContain('beforeNavigate(');
		expect(workstreamsLayout).not.toContain('onPreviewDestination=');
		expect(workstreamsLayout).not.toContain('PaneLoadingSkeleton');
		expect(workstreamsLayout).not.toContain('workstream-navigation-preview');
		expect(workstreamsLayout).not.toContain('visibleWorkstreamDestination');
		expect(workstreamsLayout).not.toContain('inert={');
	});

	it('shows the dead-bridge banner for the session that owns the run during a cold switch', () => {
		expect(agentProcessDied).toContain('const owner = sessionActivation.activeRunOwner();');
		expect(agentProcessDied).toContain('agentRunner.bridgeDeadFor(owner)');
		expect(agentProcessDied).not.toContain('workstreamId');
		expect(agentProcessDiedBanner).toContain('onclick={restartAgentCommand}');
	});

	it('keeps duplicate Git status and extension activation work outside route commit', () => {
		expect(workstreamPage).not.toContain('$effect(');
		expect(workstreamPage.match(/loadWorkstreamGitStatusCommand\(/gu)).toHaveLength(1);
		expect(workstreamPage).toContain(
			'ongitstatusstale={() => loadWorkstreamGitStatusCommand(workstreamId)}',
		);

		const activationHook = readFileSync(
			new URL('../../extensions/application/hooks/activate-extensions.hook.ts', import.meta.url),
			'utf8',
		);
		expect(activationHook).toContain(
			"import { scheduleAfterSettledNavigationPaint } from '$shared/performance/navigation-paint-scheduler';",
		);
		expect(activationHook).toContain(
			'const cancelActivationRelease = scheduleAfterSettledNavigationPaint(() => {',
		);
		expect(activationHook.indexOf('coordinator.activate(workstream')).toBeGreaterThan(
			activationHook.indexOf('scheduleAfterSettledNavigationPaint(() => {'),
		);
		expect(activationHook).toContain('cancelActivationRelease();');
	});
});
