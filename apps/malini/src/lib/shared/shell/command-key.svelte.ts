import { on } from 'svelte/events';
import { createSubscriber } from 'svelte/reactivity';

let held = false;

const subscribe = createSubscriber((update) => {
	const track = (event: KeyboardEvent | PointerEvent): void => {
		if (event.metaKey === held) return;
		held = event.metaKey;
		update();
	};
	const release = (): void => {
		held = false;
		update();
	};
	const stops = [
		on(window, 'keydown', track, { capture: true }),
		on(window, 'keyup', track, { capture: true }),
		on(window, 'pointermove', track, { capture: true }),
		on(window, 'blur', release),
	];
	return () => {
		for (const stop of stops) stop();
		held = false;
	};
});

export function commandKeyHeld(): boolean {
	subscribe();
	return held;
}
