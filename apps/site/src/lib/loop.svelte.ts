import type { Attachment } from 'svelte/attachments';

export class Loop {
	step = $state(0);
	readonly #durations: readonly number[];

	constructor(durations: readonly number[], initial = 0) {
		this.#durations = durations;
		this.step = initial;
	}

	get last(): number {
		return this.#durations.length - 1;
	}

	play: Attachment<HTMLElement> = (node) => {
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
			this.step = this.last;
			return;
		}
		let timer: ReturnType<typeof setTimeout> | undefined;
		const tick = () => {
			timer = setTimeout(() => {
				this.step = this.step >= this.last ? 0 : this.step + 1;
				tick();
			}, this.#durations[this.step] ?? 1000);
		};
		const observer = new IntersectionObserver(([entry]) => {
			clearTimeout(timer);
			if (entry?.isIntersecting) tick();
		});
		observer.observe(node);
		return () => {
			clearTimeout(timer);
			observer.disconnect();
		};
	};
}

export function steps(count: number, each: number, rest: number): number[] {
	return Array.from({ length: count }, (_, index) => (index === count - 1 ? rest : each));
}
