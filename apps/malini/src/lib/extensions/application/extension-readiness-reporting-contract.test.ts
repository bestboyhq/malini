import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hook = readFileSync(new URL('./hooks/activate-extensions.hook.ts', import.meta.url), 'utf8');
const coordinator = readFileSync(
	new URL('../infrastructure/runtime/extension-runtime-coordinator.ts', import.meta.url),
	'utf8',
);

describe('extension readiness reporting', () => {
	it('starts the clock when the activation runs, not when it is queued', () => {
		expect(coordinator).toContain('options.onStarted?.();');
		const enqueued = coordinator.slice(
			coordinator.indexOf('this.#enqueue(async () => {'),
			coordinator.indexOf('const service = this.#requireService();'),
		);
		expect(enqueued).toContain('options.onStarted?.();');

		expect(hook).toContain('onStarted: () => {');
		expect(hook).toContain('readinessDeadline(request.currentWorkstreamId).start(workstream.id);');
		expect(hook.match(/readinessDeadline\([^)]*\)\.start\(/gu)).toHaveLength(1);
	});

	it('raises the readiness toast only when the inspector cannot show the failure itself', () => {
		const timeout = hook.slice(
			hook.indexOf('onTimeout: (workstreamId) => {'),
			hook.indexOf('	return extensionRuntimeStore.readinessDeadline;'),
		);
		expect(timeout).toContain('extensionRuntimeStore.error =');
		expect(timeout).toContain('if (inspectorDrawer.isOpen(workstreamId)) return;');
		expect(timeout.indexOf('inspectorDrawer.isOpen(workstreamId)')).toBeLessThan(
			timeout.indexOf('Workstream inspector could not start'),
		);
	});

	it('withdraws the notice on both the success and the failure path', () => {
		const settle = hook.slice(
			hook.indexOf('function settleReadiness(workstreamId: string): void {'),
			hook.indexOf('function failReadiness('),
		);
		expect(settle).toContain('extensionRuntimeStore.readinessDeadline?.settle(workstreamId);');
		expect(settle).toContain('dismissExtensionReadinessToastCommand(workstreamId);');
	});

	it('does not answer one host failure with both a panel and a toast', () => {
		const fail = hook.slice(
			hook.indexOf('function failReadiness('),
			hook.indexOf('function reportExtensionFailure('),
		);
		expect(fail).toContain('settleReadiness(workstreamId);');
		expect(fail).toContain('extensionRuntimeStore.error = extensionErrorMessage(');
		expect(fail).toContain('if (inspectorDrawer.isOpen(workstreamId)) return;');
		expect(fail.indexOf('inspectorDrawer.isOpen(workstreamId)')).toBeLessThan(
			fail.indexOf('reportExtensionFailure(workstreamId, error);'),
		);
	});
});
