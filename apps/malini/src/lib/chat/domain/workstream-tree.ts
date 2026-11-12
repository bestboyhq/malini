export function descendantWorkstreamIds(
	rootId: string,
	workstreams: readonly Readonly<{ id: string; startedBy: string | null }>[],
): Set<string> {
	const descendants = new Set<string>();
	const reached = [rootId];
	for (let parentId = reached.pop(); parentId !== undefined; parentId = reached.pop()) {
		for (const workstream of workstreams) {
			if (workstream.startedBy !== parentId || descendants.has(workstream.id)) continue;
			descendants.add(workstream.id);
			reached.push(workstream.id);
		}
	}
	descendants.delete(rootId);
	return descendants;
}
