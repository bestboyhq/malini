type DockClaim = Readonly<{ measure(width: number): void; release(): void }>;

export type DockAway = Readonly<{ offset: number; gone: boolean }>;

const IN_PLACE: DockAway = { offset: 0, gone: false };
const STAYS_IN_PLACE = (): DockAway => IN_PLACE;

class InspectorDock {
	#measured: number | null = $state(null);
	#away = $state.raw<() => DockAway>(STAYS_IN_PLACE);
	#owner: object | null = null;

	get width(): number | null {
		return this.#measured;
	}

	get away(): DockAway {
		return this.#away();
	}

	slideWith(away: () => DockAway): () => void {
		this.#away = away;
		return () => {
			if (this.#away === away) this.#away = STAYS_IN_PLACE;
		};
	}

	claim(): DockClaim {
		const owner = {};
		this.#owner = owner;
		return {
			measure: (width) => {
				if (this.#owner === owner) this.#measured = width;
			},
			release: () => {
				if (this.#owner !== owner) return;
				this.#owner = null;
				this.#measured = null;
			},
		};
	}
}

export const inspectorDock = new InspectorDock();

export function dockInspector(element: HTMLElement): () => void {
	const dock = inspectorDock.claim();
	const measure = (): void => dock.measure(element.getBoundingClientRect().width);
	measure();
	const observer = new ResizeObserver(measure);
	observer.observe(element);
	return () => {
		observer.disconnect();
		dock.release();
	};
}
