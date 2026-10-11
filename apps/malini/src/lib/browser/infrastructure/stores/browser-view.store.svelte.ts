import {
	HIDDEN_BROWSER,
	sameBrowserPlacement,
	type BrowserPlacement,
} from '../../domain/browser-placement';

class BrowserViewStore {
	snapshots: Readonly<Record<string, string>> = $state.raw({});
	picking: ReadonlySet<string> = $state.raw(new Set());
	readonly #placements = new Map<string, Readonly<{ placement: BrowserPlacement; turn: number }>>();
	#turns = 0;

	place(workstreamId: string, placement: BrowserPlacement): number | null {
		const current = this.#placements.get(workstreamId)?.placement ?? HIDDEN_BROWSER;
		if (sameBrowserPlacement(current, placement)) return null;
		this.#turns += 1;
		this.#placements.set(workstreamId, { placement, turn: this.#turns });
		return this.#turns;
	}

	isLatest(workstreamId: string, turn: number): boolean {
		return this.#placements.get(workstreamId)?.turn === turn;
	}

	setSnapshot(workstreamId: string, snapshot: string | null): void {
		if ((this.snapshots[workstreamId] ?? null) === snapshot) return;
		const next = { ...this.snapshots };
		if (snapshot === null) delete next[workstreamId];
		else next[workstreamId] = snapshot;
		this.snapshots = next;
	}

	setPicking(workstreamId: string, picking: boolean): void {
		if (this.picking.has(workstreamId) === picking) return;
		const next = new Set(this.picking);
		if (picking) next.add(workstreamId);
		else next.delete(workstreamId);
		this.picking = next;
	}
}

export const browserViewStore = new BrowserViewStore();
