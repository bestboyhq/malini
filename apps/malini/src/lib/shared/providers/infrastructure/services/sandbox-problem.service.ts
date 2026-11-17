import type { SandboxProblem } from '$contract/agent';
import { invoke } from '$shared/port/invoke';

class SandboxProblemService {
	load(): Promise<SandboxProblem | null> {
		return invoke('providers.sandbox-problem', undefined);
	}
}

export const sandboxProblemService = new SandboxProblemService();
