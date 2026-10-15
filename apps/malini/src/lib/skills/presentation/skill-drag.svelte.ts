const PICKUP_DISTANCE = 4;
const SETTLE_MS = 200;
const SETTLE_EASING = 'cubic-bezier(0.2, 0, 0, 1)';
const DROP_ZONE = '[data-skill-drop]';

type Press = Readonly<{
	pointerId: number;
	x: number;
	y: number;
	skill: string;
	row: HTMLElement;
}>;

type Point = Readonly<{ x: number; y: number }>;

export class SkillDrag {
	skill = $state<string | null>(null);
	target = $state<string | null>(null);
	settling = $state(false);

	readonly #ondrop: (skill: string, target: string) => void;
	#press: Press | null = null;
	#ghost: HTMLElement | null = null;
	#origin: Point = { x: 0, y: 0 };
	#grab: Point = { x: 0, y: 0 };
	#pointer: Point = { x: 0, y: 0 };
	#swallowClick = false;

	constructor(ondrop: (skill: string, target: string) => void) {
		this.#ondrop = ondrop;
	}

	press(event: PointerEvent, skill: string, row: HTMLElement): void {
		if (event.button !== 0 || this.skill !== null) return;
		this.#swallowClick = false;
		this.#press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, skill, row };
		window.addEventListener('pointermove', this.#move);
		window.addEventListener('pointerup', this.#release);
		window.addEventListener('pointercancel', this.#cancel);
	}

	consumeClick(): boolean {
		const swallowed = this.#swallowClick;
		this.#swallowClick = false;
		return swallowed;
	}

	ghost = (node: HTMLElement): { destroy(): void } => {
		this.#ghost = node;
		this.#place(this.#pointer);
		return {
			destroy: () => {
				if (this.#ghost === node) this.#ghost = null;
			},
		};
	};

	dispose(): void {
		this.#detach();
		this.#press = null;
		this.skill = null;
		this.target = null;
	}

	#move = (event: PointerEvent): void => {
		const press = this.#press;
		if (!press || event.pointerId !== press.pointerId) return;
		this.#pointer = { x: event.clientX, y: event.clientY };
		if (this.skill === null) {
			if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < PICKUP_DISTANCE) return;
			this.#pickUp(press);
		}
		this.#place(this.#pointer);
		const zone = document.elementFromPoint(event.clientX, event.clientY)?.closest(DROP_ZONE);
		const target = zone instanceof HTMLElement ? (zone.dataset['skillDrop'] ?? null) : null;
		if (target !== this.target) this.target = target;
	};

	#release = (event: PointerEvent): void => {
		if (!this.#press || event.pointerId !== this.#press.pointerId) return;
		const { skill, target } = this;
		this.#detach();
		this.#press = null;
		if (skill === null) return;
		setTimeout(() => (this.#swallowClick = false));
		if (target === null) {
			void this.#settleBack();
			return;
		}
		this.#ondrop(skill, target);
		void this.#settleInto();
	};

	#cancel = (): void => {
		this.#detach();
		this.#press = null;
		if (this.skill !== null) void this.#settleBack();
	};

	#escape = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape' || this.skill === null) return;
		event.preventDefault();
		event.stopPropagation();
		this.#cancel();
	};

	#pickUp(press: Press): void {
		const rect = press.row.getBoundingClientRect();
		this.#origin = { x: rect.left, y: rect.top };
		this.#grab = { x: press.x - rect.left, y: press.y - rect.top };
		this.#swallowClick = true;
		window.addEventListener('keydown', this.#escape, true);
		this.skill = press.skill;
	}

	#place(pointer: Point): void {
		if (!this.#ghost) return;
		const x = pointer.x - this.#grab.x;
		const y = pointer.y - this.#grab.y;
		this.#ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`;
	}

	async #settleBack(): Promise<void> {
		this.target = null;
		this.settling = true;
		const ghost = this.#ghost;
		if (ghost && !prefersReducedMotion()) {
			await ghost
				.animate(
					[
						{ transform: ghost.style.transform },
						{ transform: `translate3d(${this.#origin.x}px, ${this.#origin.y}px, 0)` },
					],
					{ duration: SETTLE_MS, easing: SETTLE_EASING, fill: 'forwards' },
				)
				.finished.catch(() => undefined);
		}
		this.#finish();
	}

	async #settleInto(): Promise<void> {
		this.settling = true;
		const ghost = this.#ghost;
		if (ghost) {
			await ghost
				.animate([{ opacity: 1 }, { opacity: 0 }], {
					duration: prefersReducedMotion() ? 80 : 140,
					easing: SETTLE_EASING,
					fill: 'forwards',
				})
				.finished.catch(() => undefined);
		}
		this.#finish();
	}

	#finish(): void {
		this.settling = false;
		this.skill = null;
		this.target = null;
	}

	#detach(): void {
		window.removeEventListener('pointermove', this.#move);
		window.removeEventListener('pointerup', this.#release);
		window.removeEventListener('pointercancel', this.#cancel);
		window.removeEventListener('keydown', this.#escape, true);
	}
}

function prefersReducedMotion(): boolean {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
