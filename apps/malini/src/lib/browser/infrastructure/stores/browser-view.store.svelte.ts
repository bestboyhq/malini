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

	place(tabKey: string, placement: BrowserPlacement): number | null {
		const current = this.#placements.get(tabKey)?.placement ?? HIDDEN_BROWSER;
		if (sameBrowserPlacement(current, placement)) return null;
		this.#turns += 1;
		this.#placements.set(tabKey, { placement, turn: this.#turns });
		return this.#turns;
	}

	isLatest(tabKey: string, turn: number): boolean {
		return this.#placements.get(tabKey)?.turn === turn;
	}

	setSnapshot(tabKey: string, snapshot: string | null): void {
		if ((this.snapshots[tabKey] ?? null) === snapshot) return;
		const next = { ...this.snapshots };
		if (snapshot === null) delete next[tabKey];
		else next[tabKey] = snapshot;
		this.snapshots = next;
	}

	setPicking(tabKey: string, picking: boolean): void {
		if (this.picking.has(tabKey) === picking) return;
		const next = new Set(this.picking);
		if (picking) next.add(tabKey);
		else next.delete(tabKey);
		this.picking = next;
	}
}

export const browserViewStore = new BrowserViewStore();
