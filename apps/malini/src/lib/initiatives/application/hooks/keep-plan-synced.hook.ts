import { acceptPlanSyncedCommand } from '$lib/initiatives/application/commands/accept-plan-synced.command';
import { syncPlanCommand } from '$lib/initiatives/application/commands/sync-plan.command';
import { PLAN_PULL_EVERY_MS } from '$lib/initiatives/domain/plan';
import { initiativesService } from '$lib/initiatives/infrastructure/services/initiatives.service';

export { keepPlanSyncedHook };

const shown = new Map<string, number>();

let stopPulling: (() => void) | null = null;

function keepPlanSyncedHook(repositoryFullName: string): () => void {
	shown.set(repositoryFullName, (shown.get(repositoryFullName) ?? 0) + 1);
	stopPulling ??= startPulling();
	syncPlanCommand(repositoryFullName);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		const left = (shown.get(repositoryFullName) ?? 1) - 1;
		if (left > 0) shown.set(repositoryFullName, left);
		else shown.delete(repositoryFullName);
		if (shown.size > 0) return;
		stopPulling?.();
		stopPulling = null;
	};
}

function startPulling(): () => void {
	const pull = (): void => {
		if (document.hidden) return;
		for (const repositoryFullName of shown.keys()) syncPlanCommand(repositoryFullName);
	};
	const timer = setInterval(pull, PLAN_PULL_EVERY_MS);
	document.addEventListener('visibilitychange', pull);
	const stopFollowing = initiativesService.onSynced((event) => {
		if (shown.has(event.repositoryFullName)) acceptPlanSyncedCommand(event);
	});
	return () => {
		clearInterval(timer);
		document.removeEventListener('visibilitychange', pull);
		stopFollowing();
	};
}
