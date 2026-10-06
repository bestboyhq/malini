import { afterEach, describe, expect, it, vi } from 'vitest';
import { setPlatformForTest } from '$shared/port/platform';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import type { RendererErrorPayload } from '$contract/system';
import {
	captureRendererError,
	createRendererErrorPayload,
	installRendererErrorCapture,
	persistRendererError,
	rendererErrorSinkSnapshot,
	type RendererErrorEventTarget,
} from './renderer-error-sink';

class FakeErrorTarget implements RendererErrorEventTarget {
	readonly listeners = new Map<string, Set<(event: unknown) => void>>();

	addEventListener(type: string, listener: (event: unknown) => void): void {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: (event: unknown) => void): void {
		this.listeners.get(type)?.delete(listener);
	}

	emit(type: 'error' | 'unhandledrejection', event: unknown): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
}

afterEach(() => {
	setPlatformForTest(null);
});

describe('renderer error normalization', () => {
	it('supports route-owned caught failures as a durable source', () => {
		expect(
			createRendererErrorPayload({
				source: 'caught',
				error: new Error('route load failed'),
				route: '/workstream/admin',
			}),
		).toMatchObject({ source: 'caught', error: { message: 'route load failed' } });
	});

	it('uses UTC wall-clock time, redacts query values and secrets, and emits only typed fields', () => {
		const error = Object.assign(
			new Error(
				'Authorization: Bearer top-secret token=private {"refresh_token":"json-secret"} github_pat_abcdefghijklmnopqrstuvwxyz user@example.com',
			),
			{
				stack:
					'Error: password="hunter2"\n    at /Users/alice/malini/file.ts:1:2\n    at https://user:pass@example.com/a.js',
				privatePayload: { prompt: 'must not serialize' },
			},
		);

		const payload = createRendererErrorPayload({
			source: 'window-error',
			error,
			route: 'https://malini.local/workstreams?token=secret&agent=chat-1',
			now: () => new Date('2026-07-18T12:34:56.789Z'),
		});

		expect(payload).toEqual({
			schemaVersion: 1,
			occurredAt: '2026-07-18T12:34:56.789Z',
			source: 'window-error',
			route: '/workstreams?agent=%5Bredacted%5D&token=%5Bredacted%5D',
			error: {
				name: 'Error',
				message: expect.stringContaining('Authorization: [redacted]'),
				stack: expect.stringContaining('/Users/[user]/malini/file.ts'),
			},
		});
		const encoded = JSON.stringify(payload);
		for (const secret of [
			'top-secret',
			'private',
			'abcdefghijklmnopqrstuvwxyz',
			'user@example.com',
			'hunter2',
			'json-secret',
			'user:pass',
			'must not serialize',
		]) {
			expect(encoded).not.toContain(secret);
		}
	});

	it('redacts provider keys before the message is cut to size, so no partial key survives', () => {
		const key = `sk-ant-api03-${'A1b2C3d4'.repeat(10)}`;
		const payload = createRendererErrorPayload({
			source: 'caught',
			error: new Error(`${'x'.repeat(490)} ANTHROPIC_API_KEY=${key} then ${key} 'x-api-key': 'k1'`),
			route: '/',
		});

		expect(payload.error.message).not.toContain('sk-ant');
		expect(payload.error.message).not.toContain('A1b2');
		expect(
			createRendererErrorPayload({
				source: 'caught',
				error: new Error(`OPENAI_API_KEY=${key} via ${key} with 'x-api-key': 'k1'`),
				route: '/',
			}).error.message,
		).toBe("OPENAI_API_KEY=[redacted] via [redacted-token] with 'x-api-key': [redacted]");
	});

	it('bounds every diagnostic field and survives hostile error accessors', () => {
		const hostile = Object.create(null, {
			name: { get: () => 'N'.repeat(200) },
			message: { get: () => 'M'.repeat(2_000) },
			stack: { get: () => 'S'.repeat(20_000) },
			toString: {
				value: () => {
					throw new Error('toString failed');
				},
			},
		});

		const payload = createRendererErrorPayload({
			source: 'caught',
			error: hostile,
			route: `/${'r'.repeat(2_000)}?unsafe=value`,
		});

		expect([...payload.error.name]).toHaveLength(80);
		expect([...payload.error.message]).toHaveLength(512);
		expect([...(payload.error.stack ?? '')]).toHaveLength(8_192);
		expect([...payload.route].length).toBeLessThanOrEqual(1_024);
	});
});

describe('early renderer error capture', () => {
	it('captures window errors and unhandled rejections once, without the deferred resize notice', async () => {
		const target = new FakeErrorTarget();
		const records: RendererErrorPayload[] = [];
		const persist = vi.fn(async (payload: RendererErrorPayload) => {
			records.push(payload);
			return null;
		});
		const first = new Error('window failure');
		const cleanup = installRendererErrorCapture({
			target,
			persist,
			route: () => '/workstream?token=private',
			now: () => new Date('2026-07-18T12:00:00.000Z'),
		});

		target.emit('error', { error: first, message: first.message });
		target.emit('error', { error: first, message: first.message });
		target.emit('error', {
			error: null,
			message: 'ResizeObserver loop completed with undelivered notifications.',
		});
		target.emit('unhandledrejection', { reason: new TypeError('rejected') });
		await Promise.resolve();

		expect(records.map(({ source }) => source)).toEqual(['window-error', 'unhandled-rejection']);
		expect(records.every(({ route }) => route === '/workstream?token=%5Bredacted%5D')).toBe(true);
		cleanup();
		expect(target.listeners.get('error')?.size).toBe(0);
		expect(target.listeners.get('unhandledrejection')?.size).toBe(0);
	});

	it('persists console errors while preserving and restoring the original reporter', async () => {
		const target = new FakeErrorTarget();
		const records: RendererErrorPayload[] = [];
		const originalError = vi.fn();
		const errorConsole = { error: originalError };
		const cleanup = installRendererErrorCapture({
			target,
			errorConsole,
			persist: async (payload) => {
				records.push(payload);
				return null;
			},
			route: () => '/workstream',
		});
		const failure = new Error('console failure');

		errorConsole.error('context', failure);
		await Promise.resolve();

		expect(originalError).toHaveBeenCalledWith('context', failure);
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			source: 'console-error',
			route: '/workstream',
			error: { name: 'Error', message: 'console failure' },
		});

		cleanup();
		errorConsole.error('after cleanup');
		await Promise.resolve();
		expect(originalError).toHaveBeenLastCalledWith('after cleanup');
		expect(records).toHaveLength(1);
	});

	it('bounds a console-error storm and exposes dropped diagnostics', async () => {
		const target = new FakeErrorTarget();
		const persisted: RendererErrorPayload[] = [];
		const originalError = vi.fn();
		const errorConsole = { error: originalError };
		const before = rendererErrorSinkSnapshot();
		const cleanup = installRendererErrorCapture({
			target,
			errorConsole,
			persist: async (payload) => {
				persisted.push(payload);
				return null;
			},
			now: () => new Date('2099-01-01T00:00:00.000Z'),
		});

		for (let index = 0; index < 25; index += 1) errorConsole.error(`storm ${index}`);
		await Promise.resolve();
		await Promise.resolve();

		expect(originalError).toHaveBeenCalledTimes(25);
		expect(persisted).toHaveLength(20);
		expect(rendererErrorSinkSnapshot().dropped - before.dropped).toBe(5);
		cleanup();
	});

	it('absorbs synchronous and asynchronous sink failures', async () => {
		const syncTarget = new FakeErrorTarget();
		installRendererErrorCapture({
			target: syncTarget,
			persist: () => {
				throw new Error('sink unavailable');
			},
		});
		expect(() => syncTarget.emit('error', { error: new Error('original') })).not.toThrow();

		const asyncTarget = new FakeErrorTarget();
		installRendererErrorCapture({
			target: asyncTarget,
			persist: () => Promise.reject(new Error('sink rejected')),
		});
		expect(() =>
			asyncTarget.emit('unhandledrejection', { reason: new Error('original rejection') }),
		).not.toThrow();
		await Promise.resolve();
		await Promise.resolve();
	});

	it('keeps the newest payload paired with its receipt when persistence settles out of order', async () => {
		const target = new FakeErrorTarget();
		const pending: Array<
			(receipt: { path: string; persistedAt: string; sizeBytes: number; rotated: boolean }) => void
		> = [];
		let timestamp = 0;
		const cleanup = installRendererErrorCapture({
			target,
			persist: () =>
				new Promise((resolve) => {
					pending.push(resolve);
				}),
			now: () => new Date(`2088-01-01T00:00:0${timestamp++}.000Z`),
		});

		target.emit('error', { error: new Error('first') });
		target.emit('error', { error: new Error('second') });
		expect(pending).toHaveLength(2);
		pending[1]?.({ path: '/second', persistedAt: 'second', sizeBytes: 2, rotated: false });
		await Promise.resolve();
		pending[0]?.({ path: '/first', persistedAt: 'first', sizeBytes: 1, rotated: false });
		await Promise.resolve();

		expect(rendererErrorSinkSnapshot()).toMatchObject({
			lastPayload: { error: { message: 'second' } },
			lastReceipt: { path: '/second', persistedAt: 'second' },
		});
		cleanup();
	});

	it('forwards a captured error to the durable native sink as the command payload', async () => {
		const fake = createFakePlatform();
		setPlatformForTest(fake);

		const payload = captureRendererError('caught', new Error('captured'), '/workstream');
		await Promise.resolve();

		expect(payload?.source).toBe('caught');
		expect(fake.calls.at(-1)).toEqual({ command: 'app.report-renderer-error', args: { payload } });
	});

	it('resolves the native receipt for a persisted renderer error', async () => {
		const fake = createFakePlatform();
		setPlatformForTest(fake);
		const payload = createRendererErrorPayload({
			source: 'unhandled-rejection',
			error: new Error('probe'),
			route: '/workstreams',
			now: () => new Date('2026-07-18T12:00:00.000Z'),
		});

		const receipt = await persistRendererError(payload);

		expect(receipt).toEqual({
			path: '/fake/Library/Application Support/com.malini.app.fake/diagnostics/renderer-errors.ndjson',
			persistedAt: payload.occurredAt,
			sizeBytes: new TextEncoder().encode(`${JSON.stringify(payload)}\n`).byteLength,
			rotated: false,
		});
	});

	it('never rejects when native persistence fails', async () => {
		const fake = createFakePlatform();
		setPlatformForTest(fake);
		fake.define('app.report-renderer-error', async () => {
			throw new Error('native sink failed');
		});

		await expect(
			persistRendererError(
				createRendererErrorPayload({
					source: 'window-error',
					error: new Error('second'),
					route: '/',
				}),
			),
		).resolves.toBeNull();
	});

	it('retries a bounded transient native persistence failure', async () => {
		const fake = createFakePlatform();
		setPlatformForTest(fake);
		let attempts = 0;
		fake.define('app.report-renderer-error', async ({ payload }) => {
			attempts += 1;
			if (attempts < 3) throw new Error('native runtime restarting');
			return {
				path: '/diagnostics/renderer-errors.ndjson',
				persistedAt: payload.occurredAt,
				sizeBytes: 1,
				rotated: false,
			};
		});

		await expect(
			persistRendererError(
				createRendererErrorPayload({
					source: 'window-error',
					error: new Error('transient'),
					route: '/',
				}),
			),
		).resolves.toMatchObject({ path: '/diagnostics/renderer-errors.ndjson' });
		expect(attempts).toBe(3);
	});
});
