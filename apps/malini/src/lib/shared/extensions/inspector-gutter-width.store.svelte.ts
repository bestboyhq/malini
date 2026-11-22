import {
	clampSize,
	defaultStorageKey,
	loadPanelSize,
	savePanelSize,
} from '$hyper-ui/components/resizable-split';

export const INSPECTOR_GUTTER_MIN_WIDTH = 288;
export const INSPECTOR_GUTTER_MAX_WIDTH = 620;

const STORAGE_KEY = defaultStorageKey('inspector-gutter-width');

class InspectorGutterWidth {
	#width = $state(
		loadPanelSize(
			STORAGE_KEY,
			INSPECTOR_GUTTER_MIN_WIDTH,
			INSPECTOR_GUTTER_MIN_WIDTH,
			INSPECTOR_GUTTER_MAX_WIDTH,
		),
	);

	get current(): number {
		return this.#width;
	}

	set(next: number): void {
		this.#width = clampSize(next, INSPECTOR_GUTTER_MIN_WIDTH, INSPECTOR_GUTTER_MAX_WIDTH);
	}

	persist(): void {
		savePanelSize(STORAGE_KEY, this.#width);
	}
}

export const inspectorGutterWidth = new InspectorGutterWidth();
