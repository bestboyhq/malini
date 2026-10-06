import { gutterRows, type GutterChangeTotals, type GutterRow } from './inspector-gutter-row';
import { INSPECTOR_MIN_WIDTH, inspectorMinWidth } from './inspector-min-width';
import type { InspectorPanel } from './inspector-panel';

export type InspectorGutterSource = Readonly<{
	workstreamId: () => string;
	workstreamName: () => string | null;
	panels: () => readonly InspectorPanel[];
	hiddenPanelIds: () => readonly string[];
	changeTotals: () => GutterChangeTotals | null;
	interactive: () => boolean;
	openPanel: (panelId: string) => void;
}>;

const NO_ROWS: readonly GutterRow[] = [];

class InspectorGutter {
	#source = $state.raw<InspectorGutterSource | null>(null);

	connect(source: InspectorGutterSource): () => void {
		this.#source = source;
		return () => {
			if (this.#source !== source) return;
			this.#source = null;
		};
	}

	#for(workstreamId: string): InspectorGutterSource | null {
		const source = this.#source;
		return source && source.workstreamId() === workstreamId ? source : null;
	}

	rowsFor(workstreamId: string): readonly GutterRow[] {
		const source = this.#for(workstreamId);
		if (!source) return NO_ROWS;
		return gutterRows({
			panels: source.panels(),
			hiddenPanelIds: source.hiddenPanelIds(),
			changeTotals: source.changeTotals(),
		});
	}

	workstreamNameFor(workstreamId: string): string | null {
		return this.#for(workstreamId)?.workstreamName() ?? null;
	}

	minWidthFor(workstreamId: string): number {
		const source = this.#for(workstreamId);
		if (!source) return INSPECTOR_MIN_WIDTH;
		return inspectorMinWidth(source.panels(), source.hiddenPanelIds());
	}

	isInteractive(workstreamId: string): boolean {
		return this.#for(workstreamId)?.interactive() ?? false;
	}

	openPanel(workstreamId: string, panelId: string): void {
		this.#for(workstreamId)?.openPanel(panelId);
	}
}

export const inspectorGutter = new InspectorGutter();
