const INITIAL_DELAY = 180;
const WARM_DELAY = 30;
const COOLDOWN = 1500;

let lastTooltipDismissedAt = 0;

export function getShowDelay(): number {
	const elapsed = performance.now() - lastTooltipDismissedAt;
	return elapsed < COOLDOWN ? WARM_DELAY : INITIAL_DELAY;
}

export function markTooltipDismissed(): void {
	lastTooltipDismissedAt = performance.now();
}
