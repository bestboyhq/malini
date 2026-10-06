import type { Action } from 'svelte/action';
import { computeOverflowTabs } from './overflow-tabs';

interface OverflowTabsOptions<T> {
	getItems: () => readonly T[];
	getId: (item: T) => string;
	getPinnedId: () => string | null;
	gap: number;
	fallbackVisibleCount?: number;
}

export function useOverflowTabs<T>(options: OverflowTabsOptions<T>) {
	let availableWidth = $state(0);
	let reservedWidth = $state(0);
	let overflowWidth = $state(0);
	let itemWidths = $state<Record<string, number>>({});

	const split = $derived.by(() =>
		computeOverflowTabs({
			items: options.getItems(),
			getId: options.getId,
			pinnedId: options.getPinnedId(),
			measurements: {
				availableWidth,
				reservedWidth,
				overflowWidth,
				itemWidths,
				gap: options.gap,
			},
			...(options.fallbackVisibleCount === undefined
				? {}
				: { fallbackVisibleCount: options.fallbackVisibleCount }),
		}),
	);

	let container: HTMLElement | null = null;

	const measureContainer = (): void => {
		if (container) availableWidth = container.getBoundingClientRect().width;
	};

	const observeContainer: Action<HTMLElement> = (element) => {
		container = element;
		measureContainer();
		const observer = new ResizeObserver(measureContainer);
		observer.observe(element);
		return {
			destroy: () => {
				observer.disconnect();
				if (container === element) container = null;
			},
		};
	};

	const measureItems: Action<HTMLElement> = (element) => {
		const measure = (): void => {
			const nextWidths: Record<string, number> = {};
			for (const item of element.querySelectorAll<HTMLElement>('[data-overflow-measure-item]')) {
				const id = item.dataset.overflowMeasureItem;
				if (id) nextWidths[id] = item.getBoundingClientRect().width;
			}
			reservedWidth =
				element
					.querySelector<HTMLElement>('[data-overflow-measure-reserved]')
					?.getBoundingClientRect().width ?? 0;
			overflowWidth =
				element
					.querySelector<HTMLElement>('[data-overflow-measure-trigger]')
					?.getBoundingClientRect().width ?? 0;
			itemWidths = nextWidths;
		};
		measure();
		const resizeObserver = new ResizeObserver(measure);
		resizeObserver.observe(element);
		const mutationObserver = new MutationObserver(measure);
		mutationObserver.observe(element, { childList: true, characterData: true, subtree: true });
		return {
			destroy: () => {
				resizeObserver.disconnect();
				mutationObserver.disconnect();
			},
		};
	};

	return {
		get visible(): T[] {
			return split.visible;
		},
		get hidden(): T[] {
			return split.hidden;
		},
		observeContainer,
		measureContainer,
		measureItems,
	};
}
