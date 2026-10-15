import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { router } from '$shared/router/hash-router.svelte';
import App from '../App.svelte';

let host: HTMLDivElement;
let app: ReturnType<typeof mount> | null = null;

beforeEach(() => {
	window.history.replaceState(null, '', '#/');
	host = document.createElement('div');
	document.body.append(host);
	setPlatformForTest(
		createFakePlatform({
			projects: [
				{
					id: 'project-hutch',
					name: 'hutch',
					repoPath: '/tmp/base/hutch',
					defaultBranch: 'main',
					remoteUrl: 'https://github.com/rabbits/hutch.git',
				},
			],
		}),
	);
});

afterEach(() => {
	if (app) void unmount(app, { outro: false });
	app = null;
	router.stop();
	host.remove();
	setPlatformForTest(null);
});

function named(selector: string, name: string): HTMLElement | null {
	return (
		[...document.querySelectorAll<HTMLElement>(selector)].find(
			(element) =>
				(element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '') === name,
		) ?? null
	);
}

const settingsDialog = (): HTMLElement | null => named('[role="dialog"]', 'Settings');
const repositoriesHeading = (): HTMLElement | null => named('h1', 'Repositories');

describe('settings', () => {
	it('open from the sidebar over the current page and close on Escape', async () => {
		app = mount(App, { target: host });
		await vi.waitFor(() => expect(repositoriesHeading()).not.toBeNull());

		named('a', 'Open settings')?.click();

		await vi.waitFor(() => expect(settingsDialog()).not.toBeNull());
		const current = named('nav', 'Settings')?.querySelector('[aria-current="page"]');
		expect(current?.textContent?.trim()).toBe('Agent');
		expect(repositoriesHeading()).not.toBeNull();
		expect(window.location.hash).toBe('#/');

		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

		await vi.waitFor(() => expect(settingsDialog()).toBeNull());
		expect(repositoriesHeading()).not.toBeNull();
	});
});
