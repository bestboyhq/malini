// @vitest-environment jsdom
import type { ExtensionPanelContext, ExtensionPanelRegistration } from '@malini/extension-api';
import { describe, expect, it, vi } from 'vitest';

import { ExtensionPanelHostController } from './extension-panel-host';

const target = document.createElement('div');
const context: ExtensionPanelContext = {
	workstream: null,
	settings: {},
	executeCommand: () => Promise.reject(new Error('This panel host harness executes no commands')),
};

function panel(
	id: string,
	events: string[],
	options: { fail?: boolean } = {},
): ExtensionPanelRegistration {
	return {
		id,
		label: id,
		icon: `${id}-icon`,
		component: {
			mount: async () => {
				events.push(`mount:${id}`);
				if (options.fail) throw new Error(`${id} failed`);
				return {
					update: () => {
						events.push(`update:${id}`);
					},
					dispose: () => {
						events.push(`dispose:${id}`);
					},
				};
			},
		},
	};
}

describe('ExtensionPanelHostController', () => {
	it('updates a stable panel and disposes it before mounting the next contribution', async () => {
		const events: string[] = [];
		const host = new ExtensionPanelHostController();
		const first = panel('first', events);
		const second = panel('second', events);

		await host.render(target, first, context);
		expect(host.isMounted(target, first)).toBe(true);
		await host.render(target, first, { ...context, settings: { compact: true } });
		await host.render(target, second, context);
		expect(host.isMounted(target, first)).toBe(false);
		expect(host.isMounted(target, second)).toBe(true);
		await host.dispose();
		expect(host.isMounted(target, second)).toBe(false);

		expect(events).toEqual([
			'mount:first',
			'update:first',
			'dispose:first',
			'mount:second',
			'dispose:second',
		]);
	});

	it('cleans up a superseded slow mount when it eventually resolves', async () => {
		const events: string[] = [];
		const host = new ExtensionPanelHostController();
		let releaseFirst!: () => void;
		let markFirstStarted!: () => void;
		let markFirstDisposed!: () => void;
		const firstStarted = new Promise<void>((resolve) => (markFirstStarted = resolve));
		const firstDisposed = new Promise<void>((resolve) => (markFirstDisposed = resolve));
		const first: ExtensionPanelRegistration = {
			id: 'slow',
			label: 'slow',
			icon: 'slow-icon',
			component: {
				mount: async () => {
					events.push('mount:slow');
					markFirstStarted();
					await new Promise<void>((resolve) => (releaseFirst = resolve));
					return {
						dispose: () => {
							events.push('dispose:slow');
							markFirstDisposed();
						},
					};
				},
			},
		};
		const second = panel('fast', events);

		const firstRender = host.render(target, first, context);
		await firstStarted;
		const secondRender = host.render(target, second, context);
		await Promise.all([firstRender, secondRender]);
		expect(events).toEqual(['mount:slow', 'mount:fast']);

		releaseFirst();
		await firstDisposed;
		expect(events).toEqual(['mount:slow', 'mount:fast', 'dispose:slow']);
	});

	it('does not let a hung third-party mount block the bundled Files panel', async () => {
		const events: string[] = [];
		const host = new ExtensionPanelHostController();
		let markHungStarted!: () => void;
		let releaseHung!: () => void;
		let markHungDisposed!: () => void;
		const hungStarted = new Promise<void>((resolve) => (markHungStarted = resolve));
		const hungGate = new Promise<void>((resolve) => (releaseHung = resolve));
		const hungDisposed = new Promise<void>((resolve) => (markHungDisposed = resolve));
		const hung: ExtensionPanelRegistration = {
			id: 'third-party.hung.panel',
			label: 'Hung third-party panel',
			icon: 'extension',
			component: {
				mount: async () => {
					events.push('mount:hung');
					markHungStarted();
					await hungGate;
					return {
						dispose: () => {
							events.push('dispose:hung');
							markHungDisposed();
						},
					};
				},
			},
		};
		const files = panel('malini.repository.files-panel', events);

		const hungRender = host.render(target, hung, context);
		await hungStarted;
		const filesRender = host.render(target, files, context);

		await Promise.all([hungRender, filesRender]);
		expect(events).toEqual(['mount:hung', 'mount:malini.repository.files-panel']);

		releaseHung();
		await hungDisposed;
		await host.dispose();
		expect(events).toEqual([
			'mount:hung',
			'mount:malini.repository.files-panel',
			'dispose:hung',
			'dispose:malini.repository.files-panel',
		]);
	});

	it('isolates a failed panel and remains able to mount another one', async () => {
		const events: string[] = [];
		const onerror = vi.fn();
		const host = new ExtensionPanelHostController(onerror);
		const broken = panel('broken', events, { fail: true });
		const healthy = panel('healthy', events);

		await host.render(target, broken, context);
		expect(host.isMounted(target, broken)).toBe(false);
		await host.render(target, healthy, context);
		expect(host.isMounted(target, healthy)).toBe(true);

		expect(onerror).toHaveBeenCalledWith(expect.any(Error), broken);
		expect(events).toEqual(['mount:broken', 'mount:healthy']);
	});

	it('disposes a panel whose context update fails', async () => {
		const events: string[] = [];
		const onerror = vi.fn();
		const host = new ExtensionPanelHostController(onerror);
		const brokenUpdate: ExtensionPanelRegistration = {
			id: 'broken-update',
			label: 'broken-update',
			icon: 'broken-update-icon',
			component: {
				mount: () => ({
					update: () => {
						throw new Error('update failed');
					},
					dispose: () => {
						events.push('dispose:broken-update');
					},
				}),
			},
		};

		await host.render(target, brokenUpdate, context);
		await host.render(target, brokenUpdate, { ...context, settings: { changed: true } });

		expect(events).toEqual(['dispose:broken-update']);
		expect(host.isMounted(target, brokenUpdate)).toBe(false);
		expect(onerror).toHaveBeenCalledWith(expect.any(Error), brokenUpdate);
	});
});
