import type {
	CreateInitiativeArgs,
	Initiative,
	PlanSync,
	PlanSyncedEvent,
	SetPlanSyncArgs,
	UpdateInitiativeArgs,
	UpdateInitiativeDependencyArgs,
} from '$contract/initiatives';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class InitiativesService {
	list(): Promise<Initiative[]> {
		return invoke('initiatives.list', undefined);
	}

	create(args: CreateInitiativeArgs): Promise<Initiative[]> {
		return invoke('initiatives.create', args);
	}

	update(args: UpdateInitiativeArgs): Promise<Initiative[]> {
		return invoke('initiatives.update', args);
	}

	delete(id: string): Promise<Initiative[]> {
		return invoke('initiatives.delete', { id });
	}

	addDependency(initiativeId: string, title: string): Promise<Initiative[]> {
		return invoke('initiatives.add-dependency', { initiativeId, title });
	}

	updateDependency(args: UpdateInitiativeDependencyArgs): Promise<Initiative[]> {
		return invoke('initiatives.update-dependency', args);
	}

	deleteDependency(id: string): Promise<Initiative[]> {
		return invoke('initiatives.delete-dependency', { id });
	}

	linkWorkstream(dependencyId: string, workstreamId: string): Promise<Initiative[]> {
		return invoke('initiatives.link-workstream', { dependencyId, workstreamId });
	}

	syncState(repositoryFullName: string): Promise<PlanSync> {
		return invoke('initiatives.sync-state', { repositoryFullName });
	}

	setSync(args: SetPlanSyncArgs): Promise<PlanSync> {
		return invoke('initiatives.set-sync', args);
	}

	sync(repositoryFullName: string): Promise<Initiative[]> {
		return invoke('initiatives.sync', { repositoryFullName });
	}

	onSynced(listener: (event: PlanSyncedEvent) => void): () => void {
		return onPlatformEvent('initiatives:synced', listener);
	}
}

export const initiativesService = new InitiativesService();
