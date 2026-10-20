import { describe, expect, it } from 'vitest';

import {
	consumeWorkstreamCreation,
	isWorkstreamCreationPending,
	markWorkstreamCreated,
	workstreamCreationContext,
} from '$shared/repositories/infrastructure/services/workstream-creation-marker.storage';

describe('workstream creation marker', () => {
	it('records only genuine creation calls and consumes each marker once', () => {
		const storage = new MemoryStorage();

		expect(isWorkstreamCreationPending('existing-workstream', storage)).toBe(false);
		markWorkstreamCreated('new-workstream', storage);
		markWorkstreamCreated('new-workstream', storage);

		expect(isWorkstreamCreationPending('existing-workstream', storage)).toBe(false);
		expect(isWorkstreamCreationPending('new-workstream', storage)).toBe(true);
		expect(consumeWorkstreamCreation('new-workstream', storage)).toBe(true);
		expect(consumeWorkstreamCreation('new-workstream', storage)).toBe(false);
		expect(isWorkstreamCreationPending('new-workstream', storage)).toBe(false);
	});

	it('carries typed external task context until creation automation consumes it', () => {
		const storage = new MemoryStorage();
		markWorkstreamCreated('linear-workstream', storage, {
			task: '  Implement CUR-42 · Add billing controls  ',
			source: {
				provider: ' linear ',
				resourceId: ' issue-42 ',
				title: ' CUR-42 · Add billing controls ',
				url: ' https://linear.app/acme/issue/CUR-42 ',
			},
		});

		expect(workstreamCreationContext('linear-workstream', storage)).toEqual({
			task: 'Implement CUR-42 · Add billing controls',
			source: {
				provider: 'linear',
				resourceId: 'issue-42',
				title: 'CUR-42 · Add billing controls',
				url: 'https://linear.app/acme/issue/CUR-42',
			},
		});
		expect(consumeWorkstreamCreation('linear-workstream', storage)).toBe(true);
		expect(workstreamCreationContext('linear-workstream', storage)).toBeNull();
	});

	it('fails closed when marker storage is unavailable or corrupt', () => {
		const corrupt = new MemoryStorage();
		corrupt.setItem('malini.chat.pending-created-workstreams-v1', '{');

		expect(isWorkstreamCreationPending('new-workstream', null)).toBe(false);
		expect(isWorkstreamCreationPending('new-workstream', corrupt)).toBe(false);
		expect(consumeWorkstreamCreation('new-workstream', corrupt)).toBe(false);
	});

	it('prunes creation context alongside the 128 pending-marker cap', () => {
		const storage = new MemoryStorage();
		for (let index = 0; index < 129; index += 1) {
			markWorkstreamCreated(`capped-workstream-${index}`, storage, {
				task: `Implement task ${index}`,
			});
		}

		expect(isWorkstreamCreationPending('capped-workstream-0', storage)).toBe(false);
		expect(workstreamCreationContext('capped-workstream-0', storage)).toBeNull();
		expect(isWorkstreamCreationPending('capped-workstream-128', storage)).toBe(true);
		expect(workstreamCreationContext('capped-workstream-128', storage)).toEqual({
			task: 'Implement task 128',
		});
	});

	it('keeps a recoverable in-memory marker when browser persistence fails', () => {
		const storage: WorkstreamCreationMarkerStorage = {
			getItem: () => null,
			setItem: () => {
				throw new Error('quota exceeded');
			},
		};

		expect(
			markWorkstreamCreated('fallback-workstream', storage, {
				task: 'Implement from Linear',
				source: { provider: 'linear', resourceId: 'issue-42' },
			}),
		).toBe(false);
		expect(isWorkstreamCreationPending('fallback-workstream', storage)).toBe(true);
		expect(workstreamCreationContext('fallback-workstream', storage)).toEqual({
			task: 'Implement from Linear',
			source: { provider: 'linear', resourceId: 'issue-42' },
		});
		expect(consumeWorkstreamCreation('fallback-workstream', storage)).toBe(true);
		expect(isWorkstreamCreationPending('fallback-workstream', storage)).toBe(false);
	});
});

class MemoryStorage implements WorkstreamCreationMarkerStorage {
	readonly #values = new Map<string, string>();

	getItem(key: string): string | null {
		return this.#values.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.#values.set(key, value);
	}
}

type WorkstreamCreationMarkerStorage = Pick<Storage, 'getItem' | 'setItem'>;
