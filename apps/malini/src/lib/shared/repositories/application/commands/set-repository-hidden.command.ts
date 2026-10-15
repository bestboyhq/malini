import { toast } from '$hyper-ui/components/toast';
import type { Repository } from '$shared/repositories/domain/repository';
import { retirementFailureToast } from '$shared/repositories/domain/workstream-retirement';
import { repositoriesAggregate } from '$shared/repositories/infrastructure/aggregates/repositories.aggregate.svelte';

export { setRepositoryHiddenCommand };

function setRepositoryHiddenCommand(repository: Repository, hidden: boolean): void {
	void (async () => {
		try {
			await repositoriesAggregate.setHidden(repository.id, hidden);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			toast.error(retirementFailureToast(hidden ? 'hide' : 'unhide', repository.fullName, reason));
		}
	})();
}
