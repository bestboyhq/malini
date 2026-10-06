import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShownToast } from './toast.store.svelte';

const custom = vi.fn((_component: unknown, _options?: unknown) => 'toast-1');
const dismiss = vi.fn();

vi.mock('svelte-sonner', () => ({ toast: { custom, dismiss } }));
vi.mock('./Toast.svelte', () => ({ default: 'Toast' }));

const { toast } = await import('./toast');
const { toastStore } = await import('./toast.store.svelte');

describe('observing the toasts the app shows', () => {
	beforeEach(() => {
		custom.mockReset();
		custom.mockReturnValue('toast-1');
	});

	it('tells an observer the level, text and context of every toast shown, until it stops', () => {
		const shown: ShownToast[] = [];
		const stop = toastStore.observe((entry) => shown.push(entry));

		toast.error('Could not archive Neon Circuit · It is in use', {
			context: { workstream: 'ws-1' },
		});
		toast.warning('Workstream archived, but its extension cleanup needs attention');
		toast.info('Archived hutch', { ttlMs: 5000 });
		stop();
		toast.success('Committed');

		expect(shown).toEqual([
			{
				level: 'error',
				message: 'Could not archive Neon Circuit · It is in use',
				context: { workstream: 'ws-1' },
			},
			{
				level: 'warning',
				message: 'Workstream archived, but its extension cleanup needs attention',
				context: {},
			},
			{ level: 'info', message: 'Archived hutch', context: {} },
		]);
	});

	it('still shows the toast and tells later observers when an observer throws', () => {
		const shown: ShownToast[] = [];
		const stopBroken = toastStore.observe(() => {
			throw new Error('observer broke');
		});
		const stop = toastStore.observe((entry) => shown.push(entry));

		const id = toast.error('Push failed');
		stopBroken();
		stop();

		expect(id).toBe('toast-1');
		expect(custom).toHaveBeenCalledTimes(1);
		expect(shown).toEqual([{ level: 'error', message: 'Push failed', context: {} }]);
	});

	it('does not announce a toast sonner refused to show', () => {
		const shown: ShownToast[] = [];
		const stop = toastStore.observe((entry) => shown.push(entry));
		custom.mockImplementation(() => {
			throw new Error('no toaster mounted');
		});

		expect(() => toast.error('Never shown')).toThrow('no toaster mounted');
		stop();

		expect(shown).toEqual([]);
	});
});
