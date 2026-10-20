export type InspectorPanelIdentity = Readonly<{ id: string }>;

export const INSPECTOR_KEEP_ALIVE_WORKSTREAM_LIMIT = 4;

export type InspectorPanelKeepAliveEntry<
	TPanel extends InspectorPanelIdentity,
	TContext,
> = Readonly<{
	workstreamId: string;
	panels: readonly TPanel[];
	context: TContext;
}>;

export type InspectorPanelKeepAliveState<
	TPanel extends InspectorPanelIdentity,
	TContext,
> = Readonly<{
	entries: readonly InspectorPanelKeepAliveEntry<TPanel, TContext>[];
	recency: readonly string[];
}>;

export type InspectorPanelKeepAliveInput<
	TPanel extends InspectorPanelIdentity,
	TContext,
> = Readonly<{
	workstreamId: string;
	panels: readonly TPanel[];
	hiddenPanelIds: readonly string[];
	activePanelId: string | null;
	ready: boolean;
	allowActivePanelMount: boolean;
	mountBeforeReady: boolean;
	context: TContext;
	limit?: number;
}>;

export function emptyInspectorPanelKeepAliveState<
	TPanel extends InspectorPanelIdentity,
	TContext,
>(): InspectorPanelKeepAliveState<TPanel, TContext> {
	return { entries: [], recency: [] };
}

export function inspectorPanelKeepAliveEntry<TPanel extends InspectorPanelIdentity, TContext>(
	state: InspectorPanelKeepAliveState<TPanel, TContext>,
	workstreamId: string,
): InspectorPanelKeepAliveEntry<TPanel, TContext> | null {
	return state.entries.find((entry) => entry.workstreamId === workstreamId) ?? null;
}

export function reconcileInspectorPanelKeepAlive<TPanel extends InspectorPanelIdentity, TContext>(
	current: InspectorPanelKeepAliveState<TPanel, TContext>,
	input: InspectorPanelKeepAliveInput<TPanel, TContext>,
): InspectorPanelKeepAliveState<TPanel, TContext> {
	const hidden = new Set(input.hiddenPanelIds);
	const registeredById = new Map(input.panels.map((panel) => [panel.id, panel]));
	const presented = presentedEntry(current, input, registeredById, hidden);
	const others = current.recency.filter((workstreamId) => workstreamId !== input.workstreamId);
	const recency = (presented ? [input.workstreamId, ...others] : others).slice(
		0,
		Math.max(1, input.limit ?? INSPECTOR_KEEP_ALIVE_WORKSTREAM_LIMIT),
	);
	const retained = new Set(recency);
	const entries = current.entries.flatMap((entry) => {
		if (entry.workstreamId === input.workstreamId) return presented ? [presented] : [];
		if (!retained.has(entry.workstreamId)) return [];
		if (!input.ready) return [entry];
		const panels = registeredPanels(entry.panels, registeredById, new Set());
		if (panels.length === 0) return [];
		return [sameList(panels, entry.panels) ? entry : { ...entry, panels }];
	});
	if (presented && !entries.includes(presented)) entries.push(presented);
	const mounted = new Set(entries.map(({ workstreamId }) => workstreamId));
	const nextRecency = recency.filter((workstreamId) => mounted.has(workstreamId));
	if (sameList(entries, current.entries) && sameList(nextRecency, current.recency)) return current;
	return { entries, recency: nextRecency };
}

function presentedEntry<TPanel extends InspectorPanelIdentity, TContext>(
	current: InspectorPanelKeepAliveState<TPanel, TContext>,
	input: InspectorPanelKeepAliveInput<TPanel, TContext>,
	registeredById: ReadonlyMap<string, TPanel>,
	hidden: ReadonlySet<string>,
): InspectorPanelKeepAliveEntry<TPanel, TContext> | null {
	const existing = inspectorPanelKeepAliveEntry(current, input.workstreamId);
	const mounted = existing?.panels ?? [];
	const panels = input.ready
		? registeredPanels(mounted, registeredById, hidden)
		: mounted.filter(({ id }) => !hidden.has(id));
	const mountable = input.allowActivePanelMount && (input.ready || input.mountBeforeReady);
	const active =
		mountable && input.activePanelId ? registeredById.get(input.activePanelId) : undefined;
	if (active && !hidden.has(active.id) && !panels.some(({ id }) => id === active.id)) {
		panels.push(active);
	}
	if (panels.length === 0) return null;
	const context = input.ready || !existing ? input.context : existing.context;
	if (existing && existing.context === context && sameList(panels, existing.panels)) {
		return existing;
	}
	return { workstreamId: input.workstreamId, panels, context };
}

function registeredPanels<TPanel extends InspectorPanelIdentity>(
	mounted: readonly TPanel[],
	registeredById: ReadonlyMap<string, TPanel>,
	hidden: ReadonlySet<string>,
): TPanel[] {
	return mounted.flatMap((panel) => {
		const registered = registeredById.get(panel.id);
		return registered && !hidden.has(panel.id) ? [registered] : [];
	});
}

function sameList<TItem>(left: readonly TItem[], right: readonly TItem[]): boolean {
	return left.length === right.length && left.every((item, index) => item === right[index]);
}
