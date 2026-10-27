type StartedWorkstream = Readonly<{ id: string; startedBy: string | null }>;

export function workstreamLeads(
	workstreams: readonly StartedWorkstream[],
): ReadonlyMap<string, string> {
	const startedBy = new Map(workstreams.map(({ id, startedBy }) => [id, startedBy]));
	const leadOf = (id: string): string => {
		const reached = new Set([id]);
		let lead = id;
		for (
			let parent = startedBy.get(lead);
			parent && startedBy.has(parent) && !reached.has(parent);
			parent = startedBy.get(lead)
		) {
			reached.add(parent);
			lead = parent;
		}
		return lead;
	};
	return new Map(workstreams.map(({ id }) => [id, leadOf(id)]));
}
