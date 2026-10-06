export type SuppressionRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type OverlaySuppressionRelease = () => void;

type AnchoredMeasure = () => SuppressionRect | null;

export class OverlaySuppressionRegistry {
	#blocking = 0;
	#anchored = new Map<symbol, AnchoredMeasure>();
	#listeners = new Set<() => void>();

	get blockingDepth(): number {
		return this.#blocking;
	}

	get anchoredCount(): number {
		return this.#anchored.size;
	}

	suppress(measure?: AnchoredMeasure): OverlaySuppressionRelease {
		if (measure) {
			const token = Symbol('anchored-overlay');
			this.#anchored.set(token, measure);
			this.#notify();
			let released = false;
			return () => {
				if (released) return;
				released = true;
				this.#anchored.delete(token);
				this.#notify();
			};
		}
		this.#blocking += 1;
		this.#notify();
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.release();
		};
	}

	release(): void {
		if (this.#blocking === 0) return;
		this.#blocking -= 1;
		this.#notify();
	}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	isSuppressed(hole: SuppressionRect | null): boolean {
		if (this.#blocking > 0) return true;
		if (!hole) return false;
		for (const measure of this.#anchored.values()) {
			const rect = measure();
			if (rect && rectsOverlap(rect, hole)) return true;
		}
		return false;
	}

	reset(): void {
		this.#blocking = 0;
		this.#anchored.clear();
		this.#notify();
	}

	#notify(): void {
		for (const listener of this.#listeners) listener();
	}
}

export function rectsOverlap(left: SuppressionRect, right: SuppressionRect): boolean {
	return (
		left.x < right.x + right.width &&
		right.x < left.x + left.width &&
		left.y < right.y + right.height &&
		right.y < left.y + left.height
	);
}

export const overlaySuppression = new OverlaySuppressionRegistry();

export type OverlaySurfaceOptions = {
	anchored?: boolean;
};

export function overlaySurface(
	node: HTMLElement,
	options: OverlaySurfaceOptions = {},
): { destroy(): void } {
	const release = overlaySuppression.suppress(
		options.anchored ? () => measureNode(node) : undefined,
	);
	return { destroy: release };
}

function measureNode(node: HTMLElement): SuppressionRect | null {
	if (!node.isConnected) return null;
	const box = node.getBoundingClientRect();
	if (box.width === 0 && box.height === 0) return null;
	return { x: box.left, y: box.top, width: box.width, height: box.height };
}
