import { beforeEach, describe, expect, it, vi } from 'vitest';

type ShownToastOptions = { componentProps?: { onDismiss?: () => void } };

const custom = vi.fn((_component: unknown, _options?: ShownToastOptions) => 'toast-1');
const dismiss = vi.fn();

vi.mock('svelte-sonner', () => ({ toast: { custom, dismiss } }));
vi.mock('./Toast.svelte', () => ({ default: 'Toast' }));

const { toastStore } = await import('./toast.store.svelte');

function shownProps(): { onDismiss?: () => void } {
	return custom.mock.calls.at(-1)?.[1]?.componentProps ?? {};
}

describe('a toast action dismisses its toast', () => {
	beforeEach(() => {
		custom.mockClear();
		dismiss.mockClear();
		custom.mockReturnValue('toast-1');
	});

	it('dismisses the toast sonner just returned, not nothing', () => {
		toastStore.show('success', 'Workstream archived', {
			action: { label: 'Undo', onclick: () => undefined },
		});

		shownProps().onDismiss?.();

		expect(dismiss).toHaveBeenCalledWith('toast-1');
	});

	it('dismisses the reused pill when the caller supplied the id', () => {
		custom.mockReturnValue('caller-id');
		toastStore.show('success', 'Done', {
			id: 'caller-id',
			action: { label: 'Undo', onclick: () => undefined },
		});

		shownProps().onDismiss?.();

		expect(dismiss).toHaveBeenCalledWith('caller-id');
	});
});
