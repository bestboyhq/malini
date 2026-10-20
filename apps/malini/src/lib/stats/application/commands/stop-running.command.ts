import type { RunningItem } from '$contract/stats';
import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { workstreamRunningAggregate } from '$lib/stats/infrastructure/aggregates/workstream-running.aggregate.svelte';
import { statsService } from '$lib/stats/infrastructure/services/stats.service';

export { stopRunningCommand };

function stopRunningCommand(workstreamId: string, items: readonly RunningItem[]): void {
	const itemIds = items.map((item) => item.id);
	if (itemIds.length === 0) return;
	workstreamRunningAggregate.markStopping(workstreamId, itemIds);
	void (async () => {
		try {
			await statsService.stopRunning({ workstreamId, itemIds });
		} catch (error) {
			workstreamRunningAggregate.releaseStopping(workstreamId, itemIds);
			const names = items.map((item) => item.name).join(', ');
			const detail = error instanceof Error ? error.message.trim() : '';
			toast.error(
				detail ? `Could not stop ${names} · ${detail}` : `Could not stop ${names}`,
				aboutWorkstream(workstreamId),
			);
		}
	})();
}
