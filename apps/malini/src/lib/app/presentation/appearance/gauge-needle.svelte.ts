import { untrack } from 'svelte';
import { prefersReducedMotion, Spring } from 'svelte/motion';

const STIFFNESS = 0.0001;
const DAMPING = 0.38;
const PRECISION = 0.0005;

export class GaugeNeedle {
	readonly #spring: Spring<number[]>;
	#following: boolean = $state(false);

	constructor(start: readonly number[]) {
		this.#spring = new Spring([...start], {
			stiffness: STIFFNESS,
			damping: DAMPING,
			precision: PRECISION,
		});
	}

	get following(): boolean {
		return this.#following;
	}

	at(index: number): number {
		return this.#spring.current[index] ?? 0;
	}

	moveTo(target: readonly number[], instant: boolean): void {
		if (instant || prefersReducedMotion.current) {
			this.#following = false;
			void this.#spring.set([...target], { instant: true });
			return;
		}
		if (
			sameValues(
				target,
				untrack(() => this.#spring.target),
			)
		)
			return;
		void this.#follow([...target]);
	}

	async #follow(target: number[]): Promise<void> {
		this.#following = true;
		try {
			await this.#spring.set(target);
			this.#following = false;
		} catch {
			return;
		}
	}
}

function sameValues(first: readonly number[], second: readonly number[]): boolean {
	return first.every((value, index) => Math.abs(value - (second[index] ?? Infinity)) < PRECISION);
}

export type GaugeStatus = 'idle' | 'driving' | 'following';

export function gaugeStatus(grabbing: boolean, following: boolean): GaugeStatus {
	if (grabbing) return 'driving';
	return following ? 'following' : 'idle';
}
