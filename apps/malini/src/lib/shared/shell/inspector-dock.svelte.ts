type DockClaim = Readonly<{ measure(width: number): void; release(): void }>;

class InspectorDock {
	width: number | null = $state(null);
	compact = $state(false);
	empty = $state(false);
	#owner: object | null = null;

	claim(compact: boolean, empty: boolean): DockClaim {
		const owner = {};
		this.#owner = owner;
		this.compact = compact;
		this.empty = empty;
		return {
			measure: (width) => {
				if (this.#owner === owner) this.width = width;
			},
			release: () => {
				if (this.#owner !== owner) return;
				this.#owner = null;
				this.width = null;
				this.compact = false;
				this.empty = false;
			},
		};
	}
}

export const inspectorDock = new InspectorDock();

export function dockInspector(compact: boolean, empty = false) {
	return (element: HTMLElement): (() => void) => {
		const dock = inspectorDock.claim(compact, empty);
		const measure = (): void => dock.measure(element.getBoundingClientRect().width);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => {
			observer.disconnect();
			dock.release();
		};
	};
}
