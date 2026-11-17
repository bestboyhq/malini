import type { SandboxProblem } from '$contract/agent';
import { sandboxProblemService } from '$shared/providers/infrastructure/services/sandbox-problem.service';
import { sandboxProblemStore } from '$shared/providers/infrastructure/stores/sandbox-problem.store.svelte';

export { sandboxProblemQuery };

class SandboxProblemQuery {
	public readonly data: SandboxProblem | null = $derived(sandboxProblemStore.problem);
	public readonly checked: boolean = $derived(sandboxProblemStore.checked);
	#asked = false;

	async load(): Promise<void> {
		if (this.#asked) return;
		this.#asked = true;
		const problem = await sandboxProblemService.load().catch(() => null);
		if (sandboxProblemStore.checked) return;
		sandboxProblemStore.problem = problem;
		sandboxProblemStore.checked = true;
	}
}

const sandboxProblemQuery = new SandboxProblemQuery();
