import { windowsSandboxService } from '$shared/providers/infrastructure/services/windows-sandbox.service';
import { sandboxProblemStore } from '$shared/providers/infrastructure/stores/sandbox-problem.store.svelte';
import { windowsSandboxStore } from '$shared/providers/infrastructure/stores/windows-sandbox.store.svelte';

export { setUpWindowsSandboxCommand };

function setUpWindowsSandboxCommand(replace: boolean): void {
	if (windowsSandboxStore.state.kind === 'working') return;
	windowsSandboxStore.state = { kind: 'working', action: 'set-up', progress: null };
	const stopProgress = windowsSandboxService.onProgress((progress) => {
		windowsSandboxStore.state = { kind: 'working', action: 'set-up', progress };
	});
	void (async () => {
		try {
			const { outcome, reason, problem } = await windowsSandboxService.setUp(replace);
			sandboxProblemStore.problem = problem;
			sandboxProblemStore.checked = true;
			windowsSandboxStore.state =
				outcome === 'done'
					? { kind: 'idle' }
					: { kind: 'stopped', action: 'set-up', outcome, reason };
		} catch (error: unknown) {
			const reason = error instanceof Error ? error.message : String(error);
			windowsSandboxStore.state = { kind: 'stopped', action: 'set-up', outcome: 'failed', reason };
		} finally {
			stopProgress();
		}
	})();
}
