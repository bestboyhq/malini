import type { SandboxProblem } from '$contract/agent';

class SandboxProblemStore {
	problem: SandboxProblem | null = $state.raw(null);
	checked = $state(false);
}

export const sandboxProblemStore = new SandboxProblemStore();
