type DockClaim = Readonly<{ measure(width: number): void; release(): void }>;

class InspectorDock {
	width: number | null = $state(null);
	#owner: object | null = null;

	claim(): DockClaim {
		const owner = {};
		this.#owner = owner;
		return {
			measure: (width) => {
				if (this.#owner === owner) this.width = width;
			},
			release: () => {
				if (this.#owner !== owner) return;
				this.#owner = null;
				this.width = null;
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
