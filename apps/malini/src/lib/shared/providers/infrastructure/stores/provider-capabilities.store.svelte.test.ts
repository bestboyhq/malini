import { describe, expect, it, vi } from 'vitest';
import type { ProviderCapability } from '$contract/agent';
import { ProviderCapabilitiesStore } from './provider-capabilities.store.svelte';

const readyCapability: ProviderCapability = {
	state: 'ready',
	installed: true,
	authenticated: true,
	version: '2.1.196',
	account: { email: 'dev@example.com', plan: 'Claude Max' },
	models: [{ id: 'default', label: 'Default', description: 'Recommended', efforts: ['high'] }],
	defaultModel: 'default',
	message: 'Signed in as dev@example.com',
};

describe('ProviderCapabilitiesStore', () => {
	it('loads once and coalesces concurrent probes', async () => {
		let resolve!: (capabilities: ProviderCapability[]) => void;
		const load = vi.fn(
			() =>
				new Promise<ProviderCapability[]>((next) => {
					resolve = next;
				}),
		);
		const store = new ProviderCapabilitiesStore(load);

		const first = store.loadOnce();
		const second = store.loadOnce();
		expect(load).toHaveBeenCalledTimes(1);
		resolve([readyCapability]);
		await Promise.all([first, second]);
		await store.loadOnce();

		expect(load).toHaveBeenCalledTimes(1);
		expect(store.capability).toEqual(readyCapability);
	});

	it('refreshes capability truth after the initial load', async () => {
		const load = vi
			.fn<() => Promise<ProviderCapability[]>>()
			.mockResolvedValueOnce([readyCapability])
			.mockResolvedValueOnce([{ ...readyCapability, state: 'needs_auth', authenticated: false }]);
		const store = new ProviderCapabilitiesStore(load);

		await store.loadOnce();
		await store.refresh();

		expect(load).toHaveBeenCalledTimes(2);
		expect(load).toHaveBeenNthCalledWith(1, false);
		expect(load).toHaveBeenNthCalledWith(2, true);
		expect(store.capability?.state).toBe('needs_auth');
	});

	it('refreshes stale capability truth when the picker asks for it', async () => {
		const load = vi.fn(() => Promise.resolve([readyCapability]));
		const store = new ProviderCapabilitiesStore(load);

		await store.loadOnce();
		const verifiedAt = store.lastVerifiedAt;
		expect(verifiedAt).not.toBeNull();
		await store.refreshIfStale(30_000, (verifiedAt ?? 0) + 29_999);
		expect(load).toHaveBeenCalledTimes(1);

		await store.refreshIfStale(30_000, (verifiedAt ?? 0) + 30_000);
		expect(load).toHaveBeenCalledTimes(2);
		expect(load).toHaveBeenLastCalledWith(true);
	});

	it('retries a transiently failed probe when availability is requested again', async () => {
		const load = vi
			.fn<() => Promise<ProviderCapability[]>>()
			.mockRejectedValueOnce(new Error('temporary probe failure'))
			.mockResolvedValueOnce([readyCapability]);
		const store = new ProviderCapabilitiesStore(load);

		await store.loadOnce();
		expect(store.loadState).toBe('error');
		await store.refreshIfStale();

		expect(load).toHaveBeenCalledTimes(2);
		expect(load).toHaveBeenLastCalledWith(true);
		expect(store.loadState).toBe('ready');
		expect(store.error).toBeNull();
		expect(store.capability).toEqual(readyCapability);
	});

	it('keeps the last verified snapshot when a later refresh fails', async () => {
		const load = vi
			.fn<() => Promise<ProviderCapability[]>>()
			.mockResolvedValueOnce([readyCapability])
			.mockRejectedValueOnce(new Error('refresh failed'));
		const store = new ProviderCapabilitiesStore(load);

		await store.loadOnce();
		await store.refresh();

		expect(store.loadState).toBe('error');
		expect(store.error).toBe('refresh failed');
		expect(store.capability).toEqual(readyCapability);
	});

	it('probes once even when the first probe fails', async () => {
		const load = vi.fn(() => Promise.reject(new Error('probe failed')));
		const store = new ProviderCapabilitiesStore(load);

		await store.loadOnce();
		await store.loadOnce();

		expect(store.loadState).toBe('error');
		expect(load).toHaveBeenCalledTimes(1);
		expect(store.capability).toBeNull();
	});

	it('is cold only until the first probe settles', async () => {
		let resolve!: (capabilities: ProviderCapability[]) => void;
		const store = new ProviderCapabilitiesStore(
			() =>
				new Promise<ProviderCapability[]>((next) => {
					resolve = next;
				}),
		);

		const first = store.loadOnce();
		expect(store.cold).toBe(true);
		resolve([readyCapability]);
		await first;
		expect(store.cold).toBe(false);
	});
});
