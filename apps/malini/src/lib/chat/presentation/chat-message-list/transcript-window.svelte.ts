import { SvelteSet } from 'svelte/reactivity';
import type { Attachment } from 'svelte/attachments';

const MOUNT_MARGIN = '150% 0px';

export const PLACEHOLDER_ATTRIBUTE = 'data-transcript-placeholder';

export function runWindowKey(runId: string): string {
	return `run:${runId}`;
}

export function rowWindowKey(runId: string, itemKey: string): string {
	return `row:${runId}:${itemKey}`;
}

export type TranscriptWindow = {
	mounted(key: string, initially: boolean): boolean;
	heightOf(key: string): number | undefined;
	readonly textWidth: number;
	track(key: string): Attachment<HTMLElement>;
	observe(root: HTMLElement, column: HTMLElement): () => void;
	open(heights: ReadonlyMap<string, number>): void;
	heights(): ReadonlyMap<string, number>;
};

export function createTranscriptWindow(): TranscriptWindow {
	const near = new SvelteSet<string>();
	const seen = new SvelteSet<string>();
	const keys = new Map<Element, string>();
	let heights = new Map<string, number>();
	let textWidth = $state(0);
	let observer: IntersectionObserver | null = null;

	function onIntersections(entries: readonly IntersectionObserverEntry[]): void {
		for (const entry of entries) {
			const key = keys.get(entry.target);
			if (key === undefined) continue;
			const isNear = entry.isIntersecting || withinRootBounds(entry);
			if (!isNear && !entry.target.hasAttribute(PLACEHOLDER_ATTRIBUTE)) {
				heights.set(key, entry.boundingClientRect.height);
			}
			if (isNear) near.add(key);
			else near.delete(key);
			seen.add(key);
		}
	}

	function withinRootBounds(entry: IntersectionObserverEntry): boolean {
		const root = entry.rootBounds;
		const rect = entry.boundingClientRect;
		return root !== null && rect.bottom >= root.top && rect.top <= root.bottom;
	}

	return {
		mounted(key: string, initially: boolean): boolean {
			return near.has(key) || (initially && !seen.has(key));
		},

		heightOf(key: string): number | undefined {
			return heights.get(key);
		},

		get textWidth(): number {
			return textWidth;
		},

		track(key: string): Attachment<HTMLElement> {
			return (element) => {
				keys.set(element, key);
				observer?.observe(element);
				return () => {
					observer?.unobserve(element);
					keys.delete(element);
				};
			};
		},

		observe(root: HTMLElement, column: HTMLElement): () => void {
			const next = new IntersectionObserver(onIntersections, {
				root,
				rootMargin: MOUNT_MARGIN,
			});
			observer = next;
			for (const element of keys.keys()) next.observe(element);
			const columnObserver = new ResizeObserver(([entry]) => {
				if (entry) textWidth = entry.contentRect.width;
			});
			columnObserver.observe(column);
			return () => {
				columnObserver.disconnect();
				next.disconnect();
				if (observer === next) observer = null;
			};
		},

		open(remembered: ReadonlyMap<string, number>): void {
			heights = new Map(remembered);
			near.clear();
			seen.clear();
		},

		heights: () => heights,
	};
}
