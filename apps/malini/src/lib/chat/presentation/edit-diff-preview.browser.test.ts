import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import EditDiffPreview from './EditDiffPreview.svelte';

const PATCH = [
	'diff --git a/src/a.ts b/src/a.ts',
	'index 0123..4567 100644',
	'--- a/src/a.ts',
	'+++ b/src/a.ts',
	'@@ -1,2 +1,3 @@',
	' line one',
	'-line two removed',
	'+line two added',
	'+line three added',
].join('\n');

let platform: FakePlatform;
let host: HTMLElement;
let app: ReturnType<typeof mount> | null = null;

beforeEach(() => {
	platform = createFakePlatform();
	setPlatformForTest(platform);
	host = document.createElement('div');
	document.body.append(host);
});

afterEach(() => {
	if (app) void unmount(app);
	app = null;
	host.remove();
	setPlatformForTest(null);
});

describe('the current-changes preview of an edited file', () => {
	it('loads the file diff only when opened and shows its line totals', async () => {
		const diff = vi.fn(() => PATCH);
		platform.define('repositories.workstream-diff', diff);
		app = mount(EditDiffPreview, {
			target: host,
			props: { workstreamId: 'ws-diff', path: 'src/a.ts', label: 'src/a.ts' },
		});
		flushSync();
		expect(diff).not.toHaveBeenCalled();

		openPreview();

		expect(diff).toHaveBeenCalledWith({ workstreamId: 'ws-diff', path: 'src/a.ts' });
		await vi.waitFor(() =>
			expect(
				document.querySelector('[data-testid="edit-diff-preview-summary"]')?.textContent,
			).toMatch(/\+2\s*−1/u),
		);
	});

	it('says there is nothing to show when the workstream has no change to that file', async () => {
		platform.define('repositories.workstream-diff', () => '');
		app = mount(EditDiffPreview, {
			target: host,
			props: { workstreamId: 'ws-clean', path: 'src/a.ts', label: 'src/a.ts' },
		});
		flushSync();

		openPreview();

		await vi.waitFor(() =>
			expect(document.querySelector('[data-testid="edit-diff-preview-empty"]')).not.toBeNull(),
		);
	});
});

function openPreview(): void {
	const trigger = host.querySelector<HTMLElement>('[data-testid="edit-diff-preview-trigger"]');
	if (!trigger) throw new Error('the preview trigger is missing');
	trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
	flushSync();
}
