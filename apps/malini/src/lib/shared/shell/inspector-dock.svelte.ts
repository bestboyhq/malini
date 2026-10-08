class InspectorDock {
	width: number | null = $state(null);
}

export const inspectorDock = new InspectorDock();

export function dockInspector(element: HTMLElement): () => void {
	const measure = (): void => {
		inspectorDock.width = element.getBoundingClientRect().width;
	};
	measure();
	const observer = new ResizeObserver(measure);
	observer.observe(element);
	return () => {
		observer.disconnect();
		inspectorDock.width = null;
	};
}
