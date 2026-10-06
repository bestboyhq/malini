import { flushSync, mount, unmount, type ComponentProps } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Toast from './Toast.svelte';
import { toast } from './toast';

type ShownToast = { duration: number; componentProps: Record<string, unknown> };

const sonner = vi.hoisted(() => ({
	custom: vi.fn((_component: unknown, _options: unknown) => 1),
	dismiss: vi.fn(),
}));

vi.mock('svelte-sonner', () => ({ toast: sonner }));

globalThis.ResizeObserver ??= class {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
};

function isShownToast(value: unknown): value is ShownToast {
	if (typeof value !== 'object' || value === null) return false;
	return 'duration' in value && 'componentProps' in value;
}

function lastShown(): ShownToast {
	const call = sonner.custom.mock.calls.at(-1);
	if (!call) throw new Error('nothing was shown');
	const shown = call[1];
	if (!isShownToast(shown)) throw new Error('nothing was shown');
	return shown;
}

let host: HTMLElement | undefined;
let mounted: ReturnType<typeof mount> | undefined;

function render(props: ComponentProps<typeof Toast>): HTMLElement {
	host = document.createElement('div');
	document.body.append(host);
	mounted = mount(Toast, { target: host, props });
	flushSync();
	return host;
}

beforeEach(() => {
	sonner.custom.mockClear();
	sonner.dismiss.mockClear();
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	host?.remove();
	host = undefined;
});

describe('the pill', () => {
	it('renders one message and an action that fires', () => {
		const onclick = vi.fn();
		const container = render({
			level: 'info',
			message: 'Update ready',
			action: { label: 'Restart', onclick },
		});

		expect(container.textContent).toContain('Update ready');
		const action = container.querySelector<HTMLButtonElement>('[data-testid="toast-action"]');
		expect(action?.textContent?.trim()).toBe('Restart');
		action?.click();
		flushSync();
		expect(onclick).toHaveBeenCalledTimes(1);
	});

	it('dismisses itself once its action has been taken', () => {
		const onDismiss = vi.fn();
		const container = render({
			level: 'info',
			message: 'Update ready',
			action: { label: 'Restart', onclick: () => {} },
			onDismiss,
		});

		container.querySelector<HTMLButtonElement>('[data-testid="toast-action"]')?.click();
		flushSync();
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it('renders no action affordance when none was supplied', () => {
		const container = render({ level: 'success', message: 'Saved' });

		expect(container.querySelector('[data-testid="toast-action"]')).toBeNull();
	});

	it('carries no dismiss button of its own', () => {
		const container = render({ level: 'info', message: 'Update ready' });

		expect(container.querySelector('[aria-label="Dismiss notification"]')).toBeNull();
	});

	it('says which kind of message it is without relying on color alone', () => {
		const container = render({ level: 'error', message: 'Could not save' });

		expect(container.querySelector('[data-testid="toast"]')?.getAttribute('data-level')).toBe(
			'error',
		);
	});
});

describe('how long a toast stays up', () => {
	it('keeps a null ttl up indefinitely instead of falling back to the default', () => {
		toast.info('Update ready', { ttlMs: null });

		expect(lastShown().duration).toBe(Infinity);
	});

	it('spells an indefinite replacement as a finite duration sonner will honor', () => {
		toast.success('Installed', { ttlMs: null, id: 7 });

		expect(lastShown().duration).toBeGreaterThan(0);
		expect(lastShown().duration).toBeLessThan(Infinity);
	});

	it('scales an omitted ttl to how long the message takes to read', () => {
		toast.success('Saved');
		const short = lastShown().duration;

		toast.error('No GitHub token to send: could not read Username for https://github.com');
		const long = lastShown().duration;

		expect(long).toBeGreaterThan(short);
		expect(long).toBeLessThanOrEqual(8000);
	});

	it('carries the action through to the pill', () => {
		const onclick = vi.fn();
		toast.info('Update ready', { ttlMs: null, action: { label: 'Restart', onclick } });

		const props = lastShown().componentProps as {
			action?: { label: string; onclick: () => void };
		};
		expect(props.action?.label).toBe('Restart');
		props.action?.onclick();
		expect(onclick).toHaveBeenCalledTimes(1);
	});

	it('leaves a loading pill up until it is replaced', () => {
		toast.loading('Deleting workstream');

		expect(lastShown().duration).toBe(Infinity);
		expect((lastShown().componentProps as { level: string }).level).toBe('loading');
	});
});
