import { INSPECTOR_MIN_WIDTH } from './inspector-min-width';

export type InspectorGutterSource = Readonly<{
	workstreamId: () => string;
	minWidth: () => number;
	presentedPanelId: () => string | null;
}>;

class InspectorGutter {
	#source = $state.raw<InspectorGutterSource | null>(null);

	connect(source: InspectorGutterSource): () => void {
		this.#source = source;
		return () => {
			if (this.#source !== source) return;
			this.#source = null;
		};
	}

	minWidthFor(workstreamId: string): number {
		return this.#sourceFor(workstreamId)?.minWidth() ?? INSPECTOR_MIN_WIDTH;
	}

	presentedPanelFor(workstreamId: string): string | null {
		return this.#sourceFor(workstreamId)?.presentedPanelId() ?? null;
	}

	#sourceFor(workstreamId: string): InspectorGutterSource | null {
		const source = this.#source;
		return source && source.workstreamId() === workstreamId ? source : null;
	}
}

export const inspectorGutter = new InspectorGutter();
