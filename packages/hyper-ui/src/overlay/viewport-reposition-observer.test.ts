import { describe, expect, it } from 'vitest';
import {
	installedViewportRepositionListenerPairs,
	observeViewportReposition,
	viewportRepositionSubscriberCount,
	type ViewportRepositionTarget,
} from './viewport-reposition-observer';

type Registration = Readonly<{
	type: string;
	listener: EventListenerOrEventListenerObject;
	capture: boolean;
}>;

function captureFlag(options: boolean | AddEventListenerOptions | undefined): boolean {
	return typeof options === 'boolean' ? options : Boolean(options?.capture);
}

function createTarget(): ViewportRepositionTarget & {
	live: () => readonly Registration[];
	dispatch: (type: string) => void;
} {
	const registrations: Registration[] = [];
	return {
		addEventListener(
			type: string,
			listener: EventListenerOrEventListenerObject | null,
			options?: boolean | AddEventListenerOptions,
		) {
			if (!listener) return;
			registrations.push({ type, listener, capture: captureFlag(options) });
		},
		removeEventListener(
			type: string,
			listener: EventListenerOrEventListenerObject | null,
			options?: boolean | EventListenerOptions,
		) {
			if (!listener) return;
			const capture = captureFlag(options);
			const index = registrations.findIndex(
				(registration) =>
					registration.type === type &&
					registration.listener === listener &&
					registration.capture === capture,
			);
			if (index >= 0) registrations.splice(index, 1);
		},
		live: () => [...registrations],
		dispatch(type) {
			for (const registration of [...registrations]) {
				if (registration.type !== type) continue;
				if (typeof registration.listener === 'function') registration.listener(new Event(type));
				else registration.listener.handleEvent(new Event(type));
			}
		},
	};
}

describe('shared viewport reposition observer', () => {
	it('installs one capture-phase scroll listener no matter how many surfaces subscribe', () => {
		const target = createTarget();
		const releases = Array.from({ length: 300 }, () =>
			observeViewportReposition(() => undefined, target),
		);

		const scrollListeners = target.live().filter((registration) => registration.type === 'scroll');
		expect(scrollListeners).toHaveLength(1);
		expect(scrollListeners[0]?.capture).toBe(true);
		expect(target.live().filter((registration) => registration.type === 'resize')).toHaveLength(1);
		expect(viewportRepositionSubscriberCount()).toBe(300);
		expect(installedViewportRepositionListenerPairs()).toBe(1);

		for (const release of releases) release();
		expect(target.live()).toHaveLength(0);
		expect(installedViewportRepositionListenerPairs()).toBe(0);
	});

	it('fans a single scroll or resize event out to every live subscriber', () => {
		const target = createTarget();
		const seen: string[] = [];
		const releaseFirst = observeViewportReposition(() => seen.push('first'), target);
		const releaseSecond = observeViewportReposition(() => seen.push('second'), target);

		target.dispatch('scroll');
		expect(seen).toEqual(['first', 'second']);

		releaseFirst();
		target.dispatch('resize');
		expect(seen).toEqual(['first', 'second', 'second']);

		releaseSecond();
		target.dispatch('scroll');
		expect(seen).toEqual(['first', 'second', 'second']);
	});

	it('ignores repeated releases from the same subscription', () => {
		const target = createTarget();
		const release = observeViewportReposition(() => undefined, target);
		const otherRelease = observeViewportReposition(() => undefined, target);

		release();
		release();
		expect(viewportRepositionSubscriberCount()).toBe(1);
		expect(installedViewportRepositionListenerPairs()).toBe(1);

		otherRelease();
		expect(installedViewportRepositionListenerPairs()).toBe(0);
	});
});
