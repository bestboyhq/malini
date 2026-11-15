import { windowsSandboxService } from '$shared/providers/infrastructure/services/windows-sandbox.service';
import { sandboxProblemStore } from '$shared/providers/infrastructure/stores/sandbox-problem.store.svelte';
import { windowsSandboxStore } from '$shared/providers/infrastructure/stores/windows-sandbox.store.svelte';

export { removeWindowsSandboxCommand };

function removeWindowsSandboxCommand(): void {
	if (windowsSandboxStore.state.kind === 'working') return;
	windowsSandboxStore.state = { kind: 'working', action: 'remove', progress: null };
	void (async () => {
		try {
			const { outcome, reason, problem } = await windowsSandboxService.remove();
			sandboxProblemStore.problem = problem;
			sandboxProblemStore.checked = true;
			windowsSandboxStore.state =
				outcome === 'done'
					? { kind: 'idle' }
					: { kind: 'stopped', action: 'remove', outcome, reason };
		} catch (error: unknown) {
			const reason = error instanceof Error ? error.message : String(error);
			windowsSandboxStore.state = { kind: 'stopped', action: 'remove', outcome: 'failed', reason };
		}
	})();
}
