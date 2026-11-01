export const SLIDER_THUMB_PX = 16;

export function sliderPosition(value: number, min: number, max: number): string {
	const share = max > min ? (Math.min(max, Math.max(min, value)) - min) / (max - min) : 0;
	return `calc(${SLIDER_THUMB_PX / 2}px + (100% - ${SLIDER_THUMB_PX}px) * ${share})`;
}
