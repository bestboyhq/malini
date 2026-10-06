export type TooltipDismiss = () => void;

let activeHoverTooltip: TooltipDismiss | null = null;

export function claimHoverTooltip(dismiss: TooltipDismiss): void {
	if (activeHoverTooltip === dismiss) return;

	const previous = activeHoverTooltip;
	activeHoverTooltip = dismiss;
	previous?.();
}

export function releaseHoverTooltip(dismiss: TooltipDismiss): void {
	if (activeHoverTooltip === dismiss) {
		activeHoverTooltip = null;
	}
}

export function dismissActiveHoverTooltip(): void {
	const dismiss = activeHoverTooltip;
	activeHoverTooltip = null;
	dismiss?.();
}
