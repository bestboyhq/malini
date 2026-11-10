type StartedWorkstream = Readonly<{ id: string; startedBy: string | null }>;

export function workstreamRoots(
	workstreams: readonly StartedWorkstream[],
): ReadonlyMap<string, string> {
	const startedBy = new Map(workstreams.map(({ id, startedBy }) => [id, startedBy]));
	const rootOf = (id: string): string => {
		const reached = new Set([id]);
		let root = id;
		for (
			let parent = startedBy.get(root);
			parent && startedBy.has(parent) && !reached.has(parent);
			parent = startedBy.get(root)
		) {
			reached.add(parent);
			root = parent;
		}
		return root;
	};
	return new Map(workstreams.map(({ id }) => [id, rootOf(id)]));
}
