export const HISTORY_INDEX_KEY = 'malini:history';
export const NAVIGATION_INDEX_KEY = 'malini:navigation';

export type NavigationHistoryDirection = 'back' | 'forward';

export type NavigationHistoryPrediction = Readonly<{
	direction: NavigationHistoryDirection;
	sourceIndex: number;
	targetIndex: number;
	targetUrl: string;
	revision: number;
}>;

type NavigationHistoryRecordKind =
	'entry' | 'route' | 'popstate' | 'shallow-push' | 'shallow-replace';

type NavigationHistoryEntry = Readonly<{
	historyIndex: number;
	navigationIndex: number | null;
	targetUrl: string;
	kind: NavigationHistoryRecordKind;
}>;

const MAX_HISTORY_TARGETS = 256;

export class NavigationHistoryTargetLedger {
	#entries = new Map<number, NavigationHistoryEntry>();
	#currentIndex: number | null = null;
	#revision = 0;

	reset(): void {
		this.#entries.clear();
		this.#currentIndex = null;
		this.#revision += 1;
	}

	observeEntry(state: unknown, targetUrl: string): void {
		this.#record(state, targetUrl, 'entry');
	}

	reconcileAfterNavigate(state: unknown, targetUrl: string, type: string): void {
		this.#record(state, targetUrl, type === 'popstate' ? 'popstate' : 'route');
	}

	recordPopstate(state: unknown, targetUrl: string): void {
		this.#record(state, targetUrl, 'popstate');
	}

	recordShallowCommit(kind: 'push' | 'replace', state: unknown, targetUrl: string): void {
		this.#record(state, targetUrl, kind === 'push' ? 'shallow-push' : 'shallow-replace');
	}

	adjacent(
		direction: NavigationHistoryDirection,
		currentState: unknown,
	): NavigationHistoryPrediction | null {
		const sourceIndex = historyIndexFromState(currentState) ?? this.#currentIndex;
		if (sourceIndex === null) return null;
		const targetIndex = sourceIndex + (direction === 'back' ? -1 : 1);
		const target = this.#entries.get(targetIndex);
		if (!target) return null;
		return {
			direction,
			sourceIndex,
			targetIndex,
			targetUrl: target.targetUrl,
			revision: this.#revision,
		};
	}

	isStillAdjacent(prediction: NavigationHistoryPrediction, currentState: unknown): boolean {
		const currentIndex = historyIndexFromState(currentState) ?? this.#currentIndex;
		const target = this.#entries.get(prediction.targetIndex);
		return (
			prediction.revision === this.#revision &&
			currentIndex === prediction.sourceIndex &&
			target?.targetUrl === prediction.targetUrl &&
			prediction.targetIndex === prediction.sourceIndex + (prediction.direction === 'back' ? -1 : 1)
		);
	}

	confirmsPopstate(
		prediction: NavigationHistoryPrediction,
		state: unknown,
		actualTargetUrl: string,
	): boolean {
		return (
			historyIndexFromState(state) === prediction.targetIndex &&
			actualTargetUrl === prediction.targetUrl
		);
	}

	snapshot(): Readonly<{
		currentIndex: number | null;
		revision: number;
		entries: readonly NavigationHistoryEntry[];
	}> {
		return {
			currentIndex: this.#currentIndex,
			revision: this.#revision,
			entries: [...this.#entries.values()].sort(
				(left, right) => left.historyIndex - right.historyIndex,
			),
		};
	}

	#record(state: unknown, targetUrl: string, kind: NavigationHistoryRecordKind): void {
		const historyIndex = historyIndexFromState(state);
		if (historyIndex === null || targetUrl.length === 0) return;
		const navigationIndex = navigationIndexFromState(state);

		if (
			(kind === 'route' || kind === 'shallow-push') &&
			this.#currentIndex !== null &&
			historyIndex > this.#currentIndex
		) {
			for (const entryIndex of this.#entries.keys()) {
				if (entryIndex >= historyIndex) this.#entries.delete(entryIndex);
			}
		}

		this.#entries.set(historyIndex, {
			historyIndex,
			navigationIndex,
			targetUrl,
			kind,
		});
		this.#currentIndex = historyIndex;
		this.#revision += 1;
		this.#trim();
	}

	#trim(): void {
		if (this.#entries.size <= MAX_HISTORY_TARGETS) return;
		const indexes = [...this.#entries.keys()].sort((left, right) => left - right);
		const currentIndex = this.#currentIndex;
		indexes.sort((left, right) => {
			const leftDistance = currentIndex === null ? left : Math.abs(left - currentIndex);
			const rightDistance = currentIndex === null ? right : Math.abs(right - currentIndex);
			return rightDistance - leftDistance;
		});
		for (const index of indexes.slice(0, this.#entries.size - MAX_HISTORY_TARGETS)) {
			this.#entries.delete(index);
		}
	}
}

export const navigationHistoryTargetLedger = new NavigationHistoryTargetLedger();

export function historyIndexFromState(state: unknown): number | null {
	return stateCoordinate(state, HISTORY_INDEX_KEY);
}

function navigationIndexFromState(state: unknown): number | null {
	return stateCoordinate(state, NAVIGATION_INDEX_KEY);
}

function stateCoordinate(state: unknown, key: string): number | null {
	if (!state || typeof state !== 'object') return null;
	const value = Reflect.get(state, key);
	return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

export function recordShallowHistoryCommit(kind: 'push' | 'replace'): void {
	const targetUrl = `${globalThis.location.pathname}${globalThis.location.search}`;
	navigationHistoryTargetLedger.recordShallowCommit(kind, globalThis.history.state, targetUrl);
}
