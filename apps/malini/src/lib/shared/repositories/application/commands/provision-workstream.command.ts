import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import {
	provisioningFailureMessage,
	type WorkstreamProvisioningPlan,
} from '$shared/repositories/domain/provisioning';
import { workstreamFromCreated } from '$shared/repositories/domain/workstream';
import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';
import { workstreamEventsService } from '$shared/repositories/infrastructure/services/workstream-events.service';
import { workstreamSetupEvents } from '$shared/repositories/infrastructure/services/workstream-setup-events.service';
import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';
import { workstreamRetirementStore } from '$shared/repositories/infrastructure/stores/workstream-retirement.store.svelte';
import { abandonWorkstreamProvisioningCommand } from './abandon-workstream-provisioning.command';
import { seedWorkstreamDependenciesCommand } from './seed-workstream-dependencies.command';

export { provisionWorkstreamCommand };

type BaseSync = Readonly<{ outcome: string } | { failure: string }>;

const BASE_SYNC_ATTEMPTS = 3;

function provisionWorkstreamCommand(
	plan: WorkstreamProvisioningPlan,
	onSettled?: () => void,
): void {
	workstreamProvisioning.begin(plan);
	void (async () => {
		try {
			const cloned = await createCheckout(plan);
			const baseSync = await settledBaseSync(plan, cloned);
			if (baseSync === 'gone') {
				abandonWorkstreamProvisioningCommand(plan.workstreamId);
				return;
			}
			if (baseSync !== 'fresh') reportBaseSync(plan, baseSync);
			workstreamProvisioning.settle(plan.workstreamId);
			workstreamSetupEvents.announce({ workstreamId: plan.workstreamId, status: 'ready' });
			seedWorkstreamDependenciesCommand(plan.workstreamId);
		} catch (cause) {
			workstreamProvisioning.fail(plan.workstreamId, provisioningFailureMessage(cause));
		} finally {
			onSettled?.();
		}
	})();
}

async function createCheckout(plan: WorkstreamProvisioningPlan): Promise<boolean> {
	const cloned = plan.projectRepoPath === null;
	const projectRepoPath = plan.projectRepoPath ?? (await cloneRepository(plan));
	workstreamProvisioning.advance(plan.workstreamId, 'worktree');
	const created = await workstreamsService.createWorkstream({
		projectId: plan.projectId,
		projectRepoPath,
		workstreamId: plan.workstreamId,
		name: plan.name,
		baseBranch: plan.baseBranch,
	});
	workstreamsAggregate.settlePendingWorkstream(workstreamFromCreated(created));
	return cloned;
}

async function cloneRepository(plan: WorkstreamProvisioningPlan): Promise<string> {
	workstreamProvisioning.advance(plan.workstreamId, 'cloning');
	const stopCloneProgress = workstreamEventsService.onCloneProgress(
		plan.cloneProgressId,
		(fraction) => workstreamProvisioning.reportCloneProgress(plan.workstreamId, fraction),
	);
	try {
		const projectRepoPath = await workstreamsService.createProject({ repoUrl: plan.repoUrl });
		workstreamProvisioning.resolveProjectRepoPath(plan.workstreamId, projectRepoPath);
		return projectRepoPath;
	} finally {
		stopCloneProgress();
	}
}

async function syncBase(plan: WorkstreamProvisioningPlan): Promise<BaseSync> {
	workstreamProvisioning.advance(plan.workstreamId, 'syncing');
	try {
		return { outcome: await workstreamsService.syncBase(plan.workstreamId) };
	} catch (cause) {
		return { failure: provisioningFailureMessage(cause) };
	}
}

async function settledBaseSync(
	plan: WorkstreamProvisioningPlan,
	cloned: boolean,
): Promise<BaseSync | 'fresh' | 'gone'> {
	let baseSync: BaseSync | 'fresh' = cloned ? 'fresh' : await syncBase(plan);
	for (let attempt = 1; ; attempt += 1) {
		if (!(await workstreamRemains(plan.workstreamId))) return 'gone';
		if (baseSync === 'fresh' || !('outcome' in baseSync) || baseSync.outcome !== 'cancelled') {
			return baseSync;
		}
		if (attempt >= BASE_SYNC_ATTEMPTS) {
			throw new Error(`Updating ${plan.baseBranch} kept being interrupted`);
		}
		baseSync = await syncBase(plan);
	}
}

async function workstreamRemains(workstreamId: string): Promise<boolean> {
	const retirement = workstreamRetirementStore.outcome(workstreamId);
	if (retirement && (await retirement).status === 'retired') return false;
	return workstreamsAggregate.workstreams.some((entry) => entry.id === workstreamId);
}

function reportBaseSync(plan: WorkstreamProvisioningPlan, baseSync: BaseSync): void {
	if ('failure' in baseSync) {
		toast.warning(
			`${plan.name} starts from the last fetched ${plan.baseBranch} · ${baseSync.failure}`,
			aboutWorkstream(plan.workstreamId),
		);
		return;
	}
	if (baseSync.outcome !== 'diverged') return;
	toast.info(
		`${plan.name} already has its own commits, so it stays on the ${plan.baseBranch} it started from`,
		aboutWorkstream(plan.workstreamId),
	);
}
