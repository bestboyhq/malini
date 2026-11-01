import type { OwnPullRequestsState } from '$shared/repositories/domain/own-pull-requests';

class OwnPullRequestsAggregate {
	byRepository = $state.raw<Readonly<Record<string, OwnPullRequestsState>>>({});
	continuing = $state.raw<ReadonlySet<string>>(new Set());

	stateOf(repoId: string): OwnPullRequestsState | null {
		return this.byRepository[repoId] ?? null;
	}

	set(repoId: string, state: OwnPullRequestsState): void {
		this.byRepository = { ...this.byRepository, [repoId]: state };
	}

	setContinuing(head: string, continuing: boolean): void {
		const next = new Set(this.continuing);
		if (continuing) next.add(head);
		else next.delete(head);
		this.continuing = next;
	}
}

export const ownPullRequestsAggregate = new OwnPullRequestsAggregate();
