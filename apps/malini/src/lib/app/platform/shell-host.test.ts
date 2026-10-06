import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { setFlagsFromString } from 'node:v8';
import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeNotification extends EventEmitter {
	show(): void {}
}

vi.mock('electron', () => ({
	app: { getName: () => 'malini', on: () => undefined },
	BrowserWindow: class {},
	clipboard: { writeText: () => undefined },
	Notification: Object.assign(FakeNotification, { isSupported: () => true }),
	safeStorage: {},
	screen: { on: () => undefined },
	shell: { openExternal: async () => undefined },
}));

setFlagsFromString('--expose-gc');
const collectGarbage: () => void = runInNewContext('gc');

async function afterCollection(): Promise<void> {
	for (let round = 0; round < 4; round += 1) {
		collectGarbage();
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

let shown: WeakRef<FakeNotification>[] = [];

afterEach(() => {
	shown = [];
});

async function showNotification(onClick: () => void): Promise<void> {
	const { createElectronShellHost } = await import('./shell-host');
	const original = FakeNotification.prototype.show;
	FakeNotification.prototype.show = function (this: FakeNotification): void {
		shown.push(new WeakRef(this));
	};
	try {
		createElectronShellHost().showNotification({ title: 'Waiting', body: 'Lunar', onClick });
	} finally {
		FakeNotification.prototype.show = original;
	}
}

describe('a native notification that opens a chat', () => {
	it('still opens the chat when it is clicked after garbage collection', async () => {
		const onClick = vi.fn();
		await showNotification(onClick);

		await afterCollection();
		shown[0]?.deref()?.emit('click');

		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it('is let go once it has been clicked', async () => {
		await showNotification(() => undefined);
		shown[0]?.deref()?.emit('click');

		await afterCollection();

		expect(shown[0]?.deref()).toBeUndefined();
	});
});
