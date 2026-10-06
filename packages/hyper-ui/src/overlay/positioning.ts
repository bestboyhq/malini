export type MenuSide = 'top' | 'bottom' | 'left' | 'right';
export type MenuAlign = 'start' | 'center' | 'end';

export interface PositionConfig {
	side: MenuSide;
	align: MenuAlign;
	sideOffset: number;
	alignOffset?: number;
	preventFlip?: boolean;
	viewportPadding?: number;
}

export interface PositionResult {
	top: number;
	left: number;
	actualSide: MenuSide;
}

function oppositeSide(side: MenuSide): MenuSide {
	if (side === 'top') return 'bottom';
	if (side === 'bottom') return 'top';
	if (side === 'left') return 'right';
	return 'left';
}

function positionForSide(
	triggerRect: DOMRect,
	contentRect: DOMRect,
	side: MenuSide,
	align: MenuAlign,
	sideOffset: number,
	alignOffset: number,
): { top: number; left: number } {
	if (side === 'left' || side === 'right') {
		const top =
			align === 'start'
				? triggerRect.top + alignOffset
				: align === 'end'
					? triggerRect.bottom - contentRect.height - alignOffset
					: triggerRect.top + (triggerRect.height - contentRect.height) / 2 + alignOffset;
		const left =
			side === 'left'
				? triggerRect.left - contentRect.width - sideOffset
				: triggerRect.right + sideOffset;
		return { top, left };
	}

	const left =
		align === 'start'
			? triggerRect.left + alignOffset
			: align === 'end'
				? triggerRect.right - contentRect.width - alignOffset
				: triggerRect.left + (triggerRect.width - contentRect.width) / 2 + alignOffset;
	const top =
		side === 'top'
			? triggerRect.top - contentRect.height - sideOffset
			: triggerRect.bottom + sideOffset;
	return { top, left };
}

function availableSpace(
	triggerRect: DOMRect,
	side: MenuSide,
	viewportWidth: number,
	viewportHeight: number,
	margin: number,
): number {
	if (side === 'bottom') return viewportHeight - triggerRect.bottom - margin;
	if (side === 'top') return triggerRect.top - margin;
	if (side === 'right') return viewportWidth - triggerRect.right - margin;
	return triggerRect.left - margin;
}

function overflows(
	position: { top: number; left: number },
	contentRect: DOMRect,
	viewportWidth: number,
	viewportHeight: number,
	margin: number,
): boolean {
	return (
		position.left < margin ||
		position.left > viewportWidth - contentRect.width - margin ||
		position.top < margin ||
		position.top > viewportHeight - contentRect.height - margin
	);
}

function clampToViewport(
	position: { top: number; left: number },
	contentRect: DOMRect,
	viewportWidth: number,
	viewportHeight: number,
	triggerRect: DOMRect,
	side: MenuSide,
	sideOffset: number,
	margin: number,
): { top: number; left: number } {
	const maxLeft = Math.max(margin, viewportWidth - contentRect.width - margin);
	const maxTop = Math.max(margin, viewportHeight - contentRect.height - margin);
	let { top, left } = position;

	if (side === 'bottom') top = Math.max(top, triggerRect.bottom + sideOffset);
	if (side === 'top') top = Math.min(top, triggerRect.top - contentRect.height - sideOffset);
	if (side === 'right') left = Math.max(left, triggerRect.right + sideOffset);
	if (side === 'left') left = Math.min(left, triggerRect.left - contentRect.width - sideOffset);

	return {
		top: Math.min(Math.max(top, margin), maxTop),
		left: Math.min(Math.max(left, margin), maxLeft),
	};
}

export function calculatePosition(
	triggerRect: DOMRect,
	contentRect: DOMRect,
	config: PositionConfig,
): PositionResult {
	const viewportWidth = window.innerWidth;
	const viewportHeight = window.innerHeight;
	const margin = config.viewportPadding ?? 8;
	const alignOffset = config.alignOffset ?? 0;
	let actualSide = config.side;
	let position = positionForSide(
		triggerRect,
		contentRect,
		config.side,
		config.align,
		config.sideOffset,
		alignOffset,
	);

	if (
		!config.preventFlip &&
		overflows(position, contentRect, viewportWidth, viewportHeight, margin)
	) {
		const flippedSide = oppositeSide(config.side);
		const flippedPosition = positionForSide(
			triggerRect,
			contentRect,
			flippedSide,
			config.align,
			config.sideOffset,
			alignOffset,
		);
		if (
			!overflows(flippedPosition, contentRect, viewportWidth, viewportHeight, margin) ||
			availableSpace(triggerRect, flippedSide, viewportWidth, viewportHeight, margin) >
				availableSpace(triggerRect, config.side, viewportWidth, viewportHeight, margin)
		) {
			actualSide = flippedSide;
			position = flippedPosition;
		}
	}

	return {
		...clampToViewport(
			position,
			contentRect,
			viewportWidth,
			viewportHeight,
			triggerRect,
			actualSide,
			config.sideOffset,
			margin,
		),
		actualSide,
	};
}
