import { readIds } from '$shared/repositories/repositories.api';

const STORAGE_KEY = 'malini.app.sidebar-collapsed-repositories:v1';

class CollapsedRepositoriesStore {
	ids: ReadonlySet<string> = $state(loadCollapsedRepositoryIds());

	toggle(repositoryId: string): void {
		const next = new Set(this.ids);
		if (!next.delete(repositoryId)) next.add(repositoryId);
		this.ids = next;
		try {
			globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...next]));
		} catch {}
	}
}

function loadCollapsedRepositoryIds(): ReadonlySet<string> {
	try {
		return new Set(readIds(JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null')));
	} catch {
		return new Set();
	}
}

export const collapsedRepositoriesStore = new CollapsedRepositoriesStore();
