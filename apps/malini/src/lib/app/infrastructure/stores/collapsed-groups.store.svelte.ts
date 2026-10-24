import { readIds } from '$shared/repositories/repositories.api';

const STORAGE_KEY = 'malini.app.sidebar-collapsed-repositories:v1';

class CollapsedGroupsStore {
	ids: ReadonlySet<string> = $state(loadCollapsedGroupIds());

	toggle(groupId: string): void {
		const next = new Set(this.ids);
		if (!next.delete(groupId)) next.add(groupId);
		this.ids = next;
		try {
			globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...next]));
		} catch {}
	}
}

function loadCollapsedGroupIds(): ReadonlySet<string> {
	try {
		return new Set(readIds(JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null')));
	} catch {
		return new Set();
	}
}

export const collapsedGroupsStore = new CollapsedGroupsStore();
