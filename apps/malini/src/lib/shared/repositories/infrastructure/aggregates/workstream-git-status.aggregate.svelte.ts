import type { WorkstreamGitStatus } from '$shared/repositories/domain/workstream-git-status';
import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';

class WorkstreamGitStatusAggregate {
	status: WorkstreamGitStatus | null = $state.raw(null);

	#workstreamId: string | null = null;
	#revision = 0;

	focus(workstreamId: string | null): void {
		const next = workstreamId?.trim() || null;
		if (next === this.#workstreamId) return;
		this.#workstreamId = next;
		this.#revision += 1;
		this.status = null;
	}

	async load(workstreamId: string): Promise<void> {
		const requested = workstreamId.trim();
		if (!requested || requested !== this.#workstreamId) return;
		const revision = ++this.#revision;
		try {
			const status = await workstreamsService.gitStatus(requested);
			if (this.#isCurrent(requested, revision)) this.status = status;
		} catch {
			if (this.#isCurrent(requested, revision)) this.status = null;
		}
	}

	reset(): void {
		this.#workstreamId = null;
		this.#revision += 1;
		this.status = null;
	}

	#isCurrent(workstreamId: string, revision: number): boolean {
		return this.#workstreamId === workstreamId && this.#revision === revision;
	}
}

export const workstreamGitStatusAggregate = new WorkstreamGitStatusAggregate();
