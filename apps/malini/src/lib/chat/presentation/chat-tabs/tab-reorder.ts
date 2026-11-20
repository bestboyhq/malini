import { tick } from 'svelte';
import type { Attachment } from 'svelte/attachments';
import { reorderIndex, reorderShift, settledOffset, type ReorderSlot } from '$shared/shell/reorder';
import type { WorkstreamTabPlacement } from '$shared/shell/workstream-tabs';

export type TabMove = Readonly<{
	key: string;
	targetKey: string;
	placement: WorkstreamTabPlacement;
}>;

type Drag = {
	readonly items: readonly HTMLElement[];
	readonly slots: readonly ReorderSlot[];
	readonly from: number;
	to: number;
	offset: number;
};

const KEY_ATTRIBUTE = 'data-reorder-key';
const STATE_ATTRIBUTE = 'data-reorder';
const THRESHOLD_PX = 4;
const SETTLE_MS = 150;
const SETTLE_EASING = 'cubic-bezier(0.2, 0, 0, 1)';

export function tabReorder(onmove: (move: TabMove) => void): Attachment<HTMLElement> {
	return (strip) => {
		let disarm: (() => void) | null = null;
		let settling = false;
		let clickSuppressed = false;

		function reorderItems(): HTMLElement[] {
			return [...strip.querySelectorAll<HTMLElement>(`[${KEY_ATTRIBUTE}]`)].filter(
				(item) => !item.inert,
			);
		}

		function keyOf(item: HTMLElement | undefined): string | null {
			return item?.getAttribute(KEY_ATTRIBUTE) ?? null;
		}

		function begin(item: HTMLElement): Drag | null {
			const items = reorderItems();
			const from = items.indexOf(item);
			if (from === -1 || items.length < 2) return null;
			const slots = items.map((element) => {
				const { left, right } = element.getBoundingClientRect();
				return { start: left, end: right };
			});
			for (const element of items) {
				element.setAttribute(STATE_ATTRIBUTE, element === item ? 'dragged' : 'sliding');
			}
			return { items, slots, from, to: from, offset: 0 };
		}

		function place(drag: Drag): void {
			drag.items.forEach((element, index) => {
				const x =
					index === drag.from ? drag.offset : reorderShift(drag.slots, drag.from, drag.to, index);
				element.style.transform = x === 0 ? '' : `translateX(${x}px)`;
			});
		}

		function reset(drag: Drag): void {
			for (const element of drag.items) {
				element.removeAttribute(STATE_ATTRIBUTE);
				element.style.transform = '';
			}
		}

		function follow(drag: Drag, delta: number): void {
			const first = drag.slots[0];
			const last = drag.slots.at(-1);
			const dragged = drag.slots[drag.from];
			if (!first || !last || !dragged) return;
			drag.offset = Math.min(Math.max(delta, first.start - dragged.start), last.end - dragged.end);
			drag.to = reorderIndex(drag.slots, drag.from, drag.offset);
			place(drag);
		}

		function settle(drag: Drag, commit: boolean): void {
			const dragged = drag.items[drag.from];
			if (!dragged) return;
			const released = drag.offset;
			drag.to = commit ? drag.to : drag.from;
			drag.offset = settledOffset(drag.slots, drag.from, drag.to);
			place(drag);
			settling = true;
			const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
			const animation = dragged.animate(
				[{ transform: `translateX(${released}px)` }, { transform: `translateX(${drag.offset}px)` }],
				{ duration: reducedMotion ? 0 : SETTLE_MS, easing: SETTLE_EASING },
			);
			const finish = (): void => {
				settling = false;
				reset(drag);
				const key = keyOf(dragged);
				const targetKey = keyOf(drag.items[drag.to]);
				if (drag.to === drag.from || !key || !targetKey) return;
				onmove({ key, targetKey, placement: drag.to > drag.from ? 'after' : 'before' });
			};
			animation.onfinish = finish;
			animation.oncancel = finish;
		}

		function arm(event: PointerEvent): void {
			if (disarm || settling || event.button !== 0) return;
			if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
			if (!(event.target instanceof Element) || !event.target.closest('[role=tab]')) return;
			const item = event.target.closest<HTMLElement>(`[${KEY_ATTRIBUTE}]`);
			if (!item || item.inert) return;
			const { pointerId, clientX: startX } = event;
			let drag: Drag | null = null;
			let settled = false;

			const track = (move: PointerEvent): void => {
				if (move.pointerId !== pointerId || settled) return;
				const delta = move.clientX - startX;
				if (!drag && Math.abs(delta) < THRESHOLD_PX) return;
				drag ??= begin(item);
				if (!drag) return stop();
				follow(drag, delta);
			};
			const release = (end: PointerEvent): void => {
				if (end.pointerId !== pointerId) return;
				stop();
				if (!drag) return;
				suppressNextClick();
				if (!settled) settle(drag, end.type === 'pointerup');
			};
			const cancel = (key: KeyboardEvent): void => {
				if (key.key !== 'Escape' || !drag || settled) return;
				key.preventDefault();
				key.stopPropagation();
				settled = true;
				settle(drag, false);
			};
			function stop(): void {
				window.removeEventListener('pointermove', track);
				window.removeEventListener('pointerup', release);
				window.removeEventListener('pointercancel', release);
				window.removeEventListener('keydown', cancel, true);
				disarm = null;
			}
			window.addEventListener('pointermove', track);
			window.addEventListener('pointerup', release);
			window.addEventListener('pointercancel', release);
			window.addEventListener('keydown', cancel, true);
			disarm = () => {
				stop();
				if (drag && !settled) reset(drag);
			};
		}

		function suppressNextClick(): void {
			clickSuppressed = true;
			setTimeout(() => {
				clickSuppressed = false;
			}, 0);
		}

		function swallowDragClick(event: MouseEvent): void {
			if (!clickSuppressed) return;
			clickSuppressed = false;
			event.preventDefault();
			event.stopPropagation();
		}

		function keepLinkInPlace(event: DragEvent): void {
			if (event.target instanceof Element && event.target.closest(`[${KEY_ATTRIBUTE}]`)) {
				event.preventDefault();
			}
		}

		async function moveWithKeys(event: KeyboardEvent): Promise<void> {
			if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
			if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
			const tab = event.target;
			if (!(tab instanceof HTMLElement) || tab.getAttribute('role') !== 'tab') return;
			const item = tab.closest<HTMLElement>(`[${KEY_ATTRIBUTE}]`);
			if (!item) return;
			event.preventDefault();
			const items = reorderItems();
			const index = items.indexOf(item);
			const placement = event.key === 'ArrowLeft' ? 'before' : 'after';
			const key = keyOf(item);
			const targetKey = keyOf(items[placement === 'before' ? index - 1 : index + 1]);
			if (index === -1 || !key || !targetKey) return;
			onmove({ key, targetKey, placement });
			await tick();
			tab.focus({ preventScroll: true });
		}

		strip.addEventListener('pointerdown', arm);
		strip.addEventListener('click', swallowDragClick, true);
		strip.addEventListener('dragstart', keepLinkInPlace);
		const onKeydown = (event: KeyboardEvent): void => void moveWithKeys(event);
		strip.addEventListener('keydown', onKeydown);
		return () => {
			disarm?.();
			strip.removeEventListener('pointerdown', arm);
			strip.removeEventListener('click', swallowDragClick, true);
			strip.removeEventListener('dragstart', keepLinkInPlace);
			strip.removeEventListener('keydown', onKeydown);
		};
	};
}
