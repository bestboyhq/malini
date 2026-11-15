type DockClaim = Readonly<{ measure(width: number): void; release(): void }>;

const NEVER_HELD = (): boolean => false;

class InspectorDock {
	#measured: number | null = $state(null);
	#held = $state.raw<() => boolean>(NEVER_HELD);
	#owner: object | null = null;

	get width(): number | null {
		return this.#held() ? null : this.#measured;
	}

	holdWhile(held: () => boolean): () => void {
		this.#held = held;
		return () => {
			if (this.#held === held) this.#held = NEVER_HELD;
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
