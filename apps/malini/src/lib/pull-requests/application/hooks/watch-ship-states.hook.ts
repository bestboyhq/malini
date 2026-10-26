import { toast } from '$hyper-ui/components/toast';
import { acceptShipChangeCommand } from '$lib/pull-requests/application/commands/accept-ship-change.command';
import { pullRequestActionFailureDetail } from '$lib/pull-requests/domain/pull-request-action';
import { pullRequestShipAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-ship.aggregate.svelte';
import { pullRequestShipService } from '$lib/pull-requests/infrastructure/services/pull-request-ship.service';

export function watchShipStatesHook(
	workstreamName: (workstreamId: string) => string | null,
): () => void {
	const names = new Map<string, string>();
	const nameOf = (workstreamId: string): string => {
		const name = workstreamName(workstreamId);
		if (name) names.set(workstreamId, name);
		return names.get(workstreamId) ?? 'A workstream';
	};

	const stop = pullRequestShipService.onChanged((change) =>
		acceptShipChangeCommand(change, nameOf(change.workstreamId)),
	);
	pullRequestShipAggregate.beginLoad();
	void (async () => {
		try {
			const ships = await pullRequestShipService.list();
			for (const ship of ships) nameOf(ship.workstreamId);
			pullRequestShipAggregate.finishLoad(ships);
		} catch (error) {
			toast.error(
				`Shipping status is unavailable · ${pullRequestActionFailureDetail(error, 'It could not be read')}`,
			);
		}
	})();
	return stop;
}
