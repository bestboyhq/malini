class InspectorDock {
	width: number | null = $state(null);
	compact = $state(false);
}

export const inspectorDock = new InspectorDock();

export function dockInspector(compact: boolean) {
	return (element: HTMLElement): (() => void) => {
		const measure = (): void => {
			inspectorDock.width = element.getBoundingClientRect().width;
		};
		measure();
		inspectorDock.compact = compact;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => {
			observer.disconnect();
			inspectorDock.width = null;
			inspectorDock.compact = false;
		};
	};
}
