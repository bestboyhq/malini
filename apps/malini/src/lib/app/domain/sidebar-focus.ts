export type SidebarFocus =
	| Readonly<{ kind: 'all' }>
	| Readonly<{ kind: 'owner'; owner: string }>
	| Readonly<{ kind: 'repository'; repositoryId: string }>;

export type SidebarFocusState = Readonly<{
	pinned: readonly SidebarFocus[];
	active: SidebarFocus;
}>;

export const ALL_FOCUS: SidebarFocus = { kind: 'all' };

export const DEFAULT_SIDEBAR_FOCUS: SidebarFocusState = { pinned: [], active: ALL_FOCUS };

export function focusKey(focus: SidebarFocus): string {
	if (focus.kind === 'all') return 'all';
	if (focus.kind === 'owner') return `owner:${focus.owner.toLowerCase()}`;
	return `repository:${focus.repositoryId}`;
}

export function sameFocus(left: SidebarFocus, right: SidebarFocus): boolean {
	return focusKey(left) === focusKey(right);
}

export function isPinned(state: SidebarFocusState, focus: SidebarFocus): boolean {
	return state.pinned.some((pinned) => sameFocus(pinned, focus));
}

export function togglePinned(state: SidebarFocusState, focus: SidebarFocus): SidebarFocusState {
	if (focus.kind === 'all') return state;
	if (!isPinned(state, focus)) return { ...state, pinned: [...state.pinned, focus] };
	return {
		pinned: state.pinned.filter((pinned) => !sameFocus(pinned, focus)),
		active: sameFocus(state.active, focus) ? ALL_FOCUS : state.active,
	};
}

export function chooseFocus(state: SidebarFocusState, focus: SidebarFocus): SidebarFocusState {
	return { ...state, active: focus };
}

export function focusStillExists(
	focus: SidebarFocus,
	present: Readonly<{ owners: ReadonlySet<string>; repositoryIds: ReadonlySet<string> }>,
): boolean {
	if (focus.kind === 'all') return true;
	if (focus.kind === 'owner') return present.owners.has(focus.owner.toLowerCase());
	return present.repositoryIds.has(focus.repositoryId);
}

export function readSidebarFocus(raw: unknown): SidebarFocusState {
	if (typeof raw !== 'object' || raw === null) return DEFAULT_SIDEBAR_FOCUS;
	const pinned: unknown = Reflect.get(raw, 'pinned');
	const focuses = (Array.isArray(pinned) ? pinned : [])
		.map(readFocus)
		.filter((focus): focus is SidebarFocus => focus !== null && focus.kind !== 'all');
	const unique = focuses.filter(
		(focus, index) => focuses.findIndex((other) => sameFocus(other, focus)) === index,
	);
	const active = readFocus(Reflect.get(raw, 'active')) ?? ALL_FOCUS;
	return { pinned: unique, active };
}

function readFocus(raw: unknown): SidebarFocus | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const kind = Reflect.get(raw, 'kind');
	if (kind === 'all') return ALL_FOCUS;
	const owner = Reflect.get(raw, 'owner');
	if (kind === 'owner' && typeof owner === 'string' && owner.length > 0) return { kind, owner };
	const repositoryId = Reflect.get(raw, 'repositoryId');
	if (kind === 'repository' && typeof repositoryId === 'string' && repositoryId.length > 0) {
		return { kind, repositoryId };
	}
	return null;
}
