import type { ShareRequest } from '$contract/initiatives';
import { toast } from '$hyper-ui/components/toast';
import { setPlanSyncCommand } from '$lib/initiatives/application/commands/set-plan-sync.command';
import { syncPlanCommand } from '$lib/initiatives/application/commands/sync-plan.command';
import { shareAcceptedLine, shareRequestLine } from '$lib/initiatives/domain/plan';
import { initiativesService } from '$lib/initiatives/infrastructure/services/initiatives.service';

export { watchShareRequestsHook };

function watchShareRequestsHook(onShared: (repositoryFullName: string) => void): () => void {
	const asked = new Set<string>();
	const ask = (request: ShareRequest): void => {
		const { repositoryFullName } = request;
		const key = [repositoryFullName, ...request.people].join('\n').toLowerCase();
		if (asked.has(key)) return;
		asked.add(key);
		syncPlanCommand(repositoryFullName);
		toast.info(shareRequestLine(request), {
			id: `share-request:${repositoryFullName.toLowerCase()}`,
			ttlMs: null,
			actions: [
				{
					label: 'Share',
					onclick: () =>
						setPlanSyncCommand(repositoryFullName, true, () => onShared(repositoryFullName)),
				},
				{
					label: 'Not now',
					onclick: () =>
						void initiativesService.dismissShareRequest(repositoryFullName).catch(() => undefined),
				},
			],
		});
	};
	void (async () => {
		try {
			for (const request of await initiativesService.shareRequests()) ask(request);
		} catch {
			return;
		}
	})();
	const stopAsking = initiativesService.onShareRequested(ask);
	const stopAccepting = initiativesService.onShareAccepted((event) => {
		toast.success(shareAcceptedLine(event));
		syncPlanCommand(event.repositoryFullName);
	});
	return () => {
		stopAccepting();
		stopAsking();
	};
}
