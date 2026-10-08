import { innerWidth } from 'svelte/reactivity/window';

// ponytail: sized for the default 320px sidebar beside a 480px chat and a 360px inspector; derive it from the live sidebar width if a widened sidebar squeezes the chat
const NARROW_LAYOUT_BELOW_PX = 1176;

export function isNarrowLayout(): boolean {
	return (innerWidth.current ?? Infinity) < NARROW_LAYOUT_BELOW_PX;
}
