import { describe, expect, it } from 'vitest';
import { FakeBridge } from './fake-bridge';

describe('the fake bridge', () => {
	it('answers a defined command and records the call by command name', async () => {
		const bridge = new FakeBridge();
		bridge.define('app.copy-text', () => undefined);

		await bridge.invoke('app.copy-text', { text: 'hi' });

		expect(bridge.calls).toEqual([{ command: 'app.copy-text', args: { text: 'hi' } }]);
	});

	it('rejects a command it does not define instead of answering', async () => {
		const bridge = new FakeBridge();

		await expect(bridge.invoke('app.focus-window', undefined)).rejects.toThrow(
			'the fake platform does not define `app.focus-window`',
		);
	});

	it('turns a handler that throws into a rejection', async () => {
		const bridge = new FakeBridge();
		bridge.define('app.focus-window', () => {
			throw new Error('window gone');
		});

		await expect(bridge.invoke('app.focus-window', undefined)).rejects.toThrow('window gone');
	});

	it('records the redacted arguments of a command that carries a secret', async () => {
		const bridge = new FakeBridge();
		bridge.define('app.set-secret', () => undefined);
		bridge.redactCalls('app.set-secret', ({ service, key }) => ({
			service,
			key,
			value: '[REDACTED]',
		}));

		await bridge.invoke('app.set-secret', { service: 's', key: 'k', value: 'hunter2' });

		expect(JSON.stringify(bridge.calls)).not.toContain('hunter2');
	});

	it('delivers events to listeners until they unlisten', () => {
		const bridge = new FakeBridge();
		const received: unknown[] = [];
		const off = bridge.on('app:scale-changed', (payload) => received.push(payload));

		bridge.emit('app:scale-changed', { first: true });
		expect(bridge.listenerCount('app:scale-changed')).toBe(1);
		off();
		bridge.emit('app:scale-changed', { second: true });

		expect(received).toEqual([{ first: true }]);
		expect(bridge.listenerCount('app:scale-changed')).toBe(0);
	});

	it('forgets calls and listeners on reset and tells the domain fakes', async () => {
		const bridge = new FakeBridge();
		let resets = 0;
		bridge.onReset(() => {
			resets += 1;
		});
		bridge.define('app.focus-window', () => undefined);
		bridge.on('app:scale-changed', () => undefined);
		await bridge.invoke('app.focus-window', undefined);

		bridge.reset();

		expect(bridge.calls).toEqual([]);
		expect(bridge.listenerCount('app:scale-changed')).toBe(0);
		expect(resets).toBe(1);
	});
});
