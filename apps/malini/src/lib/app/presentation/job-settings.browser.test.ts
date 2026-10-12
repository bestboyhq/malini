import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JOBS_MAX_CONCURRENT_SETTING } from '$contract/jobs';
import { MERGE_QUEUE_FIX_ATTEMPTS_SETTING } from '$contract/pull-requests';
import { jobSettingsStore } from '$lib/app/infrastructure/stores/job-settings.store.svelte';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import JobSettings from './JobSettings.svelte';

let platform: FakePlatform;
let host: HTMLDivElement;
let app: ReturnType<typeof mount> | null = null;

async function mountSettings(settings: Record<string, string> = {}): Promise<void> {
	platform = createFakePlatform({ settings });
	setPlatformForTest(platform);
	app = mount(JobSettings, { target: host });
	await vi.waitFor(() => expect(input('Jobs running at once').disabled).toBe(false));
}

beforeEach(() => {
	host = document.createElement('div');
	document.body.append(host);
});

afterEach(() => {
	if (app) void unmount(app, { outro: false });
	app = null;
	host.remove();
	jobSettingsStore.replace(null);
	setPlatformForTest(null);
	vi.restoreAllMocks();
});

function input(label: string): HTMLInputElement {
	const found = host.querySelector(`input[aria-label="${label}"]`);
	if (!(found instanceof HTMLInputElement)) throw new Error(`no field labelled ${label}`);
	return found;
}

function commit(label: string, value: string): void {
	const field = input(label);
	field.value = value;
	field.dispatchEvent(new Event('input', { bubbles: true }));
	field.dispatchEvent(new Event('change', { bubbles: true }));
	flushSync();
}

describe('the Jobs settings', () => {
	it('show the stored values, or the defaults', async () => {
		await mountSettings({ [MERGE_QUEUE_FIX_ATTEMPTS_SETTING]: '7' });

		expect(input('Jobs running at once').value).toBe('3');
		expect(input('Fix attempts before asking you').value).toBe('7');
	});

	it('save a new value', async () => {
		await mountSettings();

		commit('Jobs running at once', '5');

		await vi.waitFor(() =>
			expect(platform.snapshot().settings[JOBS_MAX_CONCURRENT_SETTING]).toBe('5'),
		);
		expect(input('Jobs running at once').value).toBe('5');
	});

	it('clamp a value outside the range before saving it', async () => {
		await mountSettings();

		commit('Jobs running at once', '50');
		commit('Fix attempts before asking you', '0');

		expect(input('Jobs running at once').value).toBe('10');
		expect(input('Fix attempts before asking you').value).toBe('1');
		await vi.waitFor(() =>
			expect(platform.snapshot().settings).toMatchObject({
				[JOBS_MAX_CONCURRENT_SETTING]: '10',
				[MERGE_QUEUE_FIX_ATTEMPTS_SETTING]: '1',
			}),
		);
	});

	it('keep the current value when the field is cleared', async () => {
		await mountSettings({ [JOBS_MAX_CONCURRENT_SETTING]: '4' });

		commit('Jobs running at once', '');

		expect(input('Jobs running at once').value).toBe('4');
		expect(platform.calls.some(({ command }) => command === 'app.set-setting')).toBe(false);
	});

	it('roll back when the value cannot be saved', async () => {
		await mountSettings();
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		platform.define('app.set-setting', () => Promise.reject(new Error('disk full')));

		commit('Fix attempts before asking you', '9');
		expect(input('Fix attempts before asking you').value).toBe('9');

		await vi.waitFor(() => expect(input('Fix attempts before asking you').value).toBe('3'));
	});
});
