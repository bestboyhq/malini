import { SvelteSet } from 'svelte/reactivity';
import type { Attachment } from 'svelte/attachments';

const MOUNT_MARGIN = '150% 0px';

export const PLACEHOLDER_ATTRIBUTE = 'data-transcript-placeholder';

export function runWindowKey(runId: string): string {
	return `run:${runId}`;
}

export type TranscriptWindow = {
	mounted(key: string, initially: boolean): boolean;
	heightOf(key: string): number | undefined;
	track(key: string): Attachment<HTMLElement>;
	observe(root: HTMLElement): () => void;
	open(heights: ReadonlyMap<string, number>): void;
	heights(): ReadonlyMap<string, number>;
};

export function createTranscriptWindow(): TranscriptWindow {
	const near = new SvelteSet<string>();
	const seen = new SvelteSet<string>();
	const keys = new Map<Element, string>();
	let heights = new Map<string, number>();
	let observer: IntersectionObserver | null = null;

	function onIntersections(entries: readonly IntersectionObserverEntry[]): void {
		for (const entry of entries) {
			const key = keys.get(entry.target);
			if (key === undefined) continue;
			if (!entry.isIntersecting && !entry.target.hasAttribute(PLACEHOLDER_ATTRIBUTE)) {
				heights.set(key, entry.boundingClientRect.height);
			}
			if (entry.isIntersecting) near.add(key);
			else near.delete(key);
			seen.add(key);
		}
	}

	return {
		mounted(key: string, initially: boolean): boolean {
			return near.has(key) || (initially && !seen.has(key));
		},

		heightOf(key: string): number | undefined {
			return heights.get(key);
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

		observe(root: HTMLElement): () => void {
			const next = new IntersectionObserver(onIntersections, {
				root,
				rootMargin: MOUNT_MARGIN,
			});
			observer = next;
			for (const element of keys.keys()) next.observe(element);
			return () => {
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
