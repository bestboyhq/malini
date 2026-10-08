import { INSPECTOR_MIN_WIDTH } from './inspector-min-width';

export type InspectorGutterSource = Readonly<{
	workstreamId: () => string;
	minWidth: () => number;
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
		const source = this.#source;
		return source && source.workstreamId() === workstreamId
			? source.minWidth()
			: INSPECTOR_MIN_WIDTH;
	}
}

export const inspectorGutter = new InspectorGutter();
