import type { Attachment } from 'svelte/attachments';

let frames: Promise<void> = Promise.resolve();

function idle(): Promise<void> {
	return new Promise((resolve) => {
		const wait = (): void => {
			if (typeof requestIdleCallback === 'function')
				requestIdleCallback(() => resolve(), { timeout: 2000 });
			else setTimeout(resolve, 200);
		};
		if (document.readyState === 'complete') wait();
		else addEventListener('load', wait, { once: true });
	});
}

export function loadWhenIdle(onload: () => void): Attachment<HTMLIFrameElement> {
	return (frame) => {
		let gone = false;
		let stop = (): void => {};
		const previous = frames;
		frames = (async () => {
			await previous;
			await idle();
			const src = frame.dataset.src;
			if (gone || !src) return;
			await new Promise<void>((resolve) => {
				stop = resolve;
				frame.addEventListener(
					'load',
					() => {
						onload();
						resolve();
					},
					{ once: true },
				);
				frame.src = src;
			});
		})();
		return () => {
			gone = true;
			stop();
		};
	};
}
