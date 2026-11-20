import type {
	CreateInitiativeArgs,
	Initiative,
	UpdateInitiativeArgs,
	UpdateInitiativeDependencyArgs,
} from '$contract/initiatives';
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
}

export const initiativesService = new InitiativesService();
