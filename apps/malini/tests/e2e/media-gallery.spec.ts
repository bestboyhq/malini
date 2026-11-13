import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
	APP_ROOT,
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	launchMalini,
	openWorkstream,
	seedWorkstream,
} from './harness';

const MEDIA = join(APP_ROOT, 'tests/e2e/fixtures/report-media');
const MINUTE = 60;

function silentWav(): Buffer {
	const samples = 8000;
	const header = Buffer.alloc(44);
	header.write('RIFF', 0);
	header.writeUInt32LE(36 + samples, 4);
	header.write('WAVEfmt ', 8);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(samples, 24);
	header.writeUInt32LE(samples, 28);
	header.writeUInt16LE(1, 32);
	header.writeUInt16LE(8, 34);
	header.write('data', 36);
	header.writeUInt32LE(samples, 40);
	return Buffer.concat([header, Buffer.alloc(samples, 128)]);
}

function placeInContext(
	worktree: string,
	file: string,
	contents: Buffer | string,
	age: number,
): void {
	const path = join(worktree, '.context', file);
	mkdirSync(join(path, '..'), { recursive: true });
	writeFileSync(path, contents);
	const at = Date.now() / 1000 - age;
	utimesSync(path, at, at);
}

function readFixture(name: string): Buffer {
	return readFileSync(join(MEDIA, name));
}

function gutter(page: Page): Locator {
	return page.getByTestId('extension-inspector-gutter');
}

test('the gutter counts the media in .context, and its gallery sorts, filters, plays and opens each kind', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root, 'media-gallery');
		const seeded = await seedWorkstream(page, source, 'e2e-media-gallery', 'Media gallery');
		const { worktree } = seeded;
		mkdirSync(join(worktree, '.context/review'), { recursive: true });
		placeInContext(worktree, 'after.png', readFixture('after.png'), MINUTE);
		placeInContext(
			worktree,
			'review/logo.svg',
			'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#3b82f6"/><script>throw new Error("svg ran a script")</script></svg>',
			2 * MINUTE,
		);
		placeInContext(worktree, 'clip.mp4', readFixture('after.mp4'), 60 * MINUTE);
		placeInContext(worktree, 'voice.wav', silentWav(), 120 * MINUTE);
		placeInContext(
			worktree,
			'proto.html',
			'<!doctype html><title>Prototype</title><h1>Prototype</h1>',
			24 * 60 * MINUTE,
		);
		placeInContext(worktree, 'notes.md', '# Notes\n\nCafé — résumé\n', 48 * 60 * MINUTE);
		placeInContext(worktree, 'run.log', 'not media', MINUTE);
		writeFileSync(join(worktree, 'outside.png'), readFixture('before.png'));
		await openWorkstream(page, seeded.workstreamId);

		const media = gutter(page).getByRole('button', { name: /^Media/u });
		await expect(media).toHaveAccessibleName('Media 6 files', { timeout: 20_000 });
		await media.click();

		const gallery = page.getByRole('dialog', { name: 'Media', exact: true });
		await expect(gallery).toBeVisible();
		const tabs = gallery.getByRole('tablist', { name: 'Media types' }).getByRole('tab');
		await expect(tabs).toHaveText([
			'All 6',
			'Images 2',
			'Videos 1',
			'Audio 1',
			'Pages 1',
			'Documents 1',
		]);
		await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
		const grid = gallery.getByRole('tabpanel');
		await expect(grid.getByRole('button')).toHaveText([
			/after\.png/u,
			/logo\.svg\s*review/u,
			/clip\.mp4/u,
			/proto\.html/u,
			/notes\.md/u,
		]);
		const voice = grid.locator('audio');
		await expect(voice).toHaveAccessibleName('voice.wav');
		await expect
			.poll(() => voice.evaluate((audio) => ('duration' in audio ? Number(audio.duration) : 0)))
			.toBe(1);
		await captureFlow(app, 'media-gallery');

		await tabs.filter({ hasText: 'Images' }).click();
		await expect(tabs.filter({ hasText: 'Images' })).toHaveAttribute('aria-selected', 'true');
		await expect(grid.getByRole('button')).toHaveText([/after\.png/u, /logo\.svg/u]);
		await expect(grid.locator('audio')).toHaveCount(0);
		const logo = grid.getByRole('button', { name: /^logo\.svg/u }).locator('img');
		await expect
			.poll(() =>
				logo.evaluate((image) => ('naturalWidth' in image ? Number(image.naturalWidth) : 0)),
			)
			.toBe(40);

		await grid.getByRole('button', { name: /^after\.png/u }).click();
		const viewer = page.getByRole('dialog', { name: 'Media, full size' });
		await expect(viewer).toBeVisible();
		await expect(viewer.getByRole('status')).toHaveText('1 of 2');
		await expect(viewer.getByRole('img', { name: 'after.png' })).toBeVisible();
		await captureFlow(app, 'media-gallery-viewer');
		await page.keyboard.press('Escape');
		await expect(viewer).toHaveCount(0);
		await expect(gallery).toBeVisible();

		await tabs.first().click();
		await grid.getByRole('button', { name: /^proto\.html/u }).click();
		await expect(viewer.getByRole('status')).toHaveText('4 of 4');
		await expect(
			viewer
				.getByTestId('media-viewer-stage')
				.frameLocator('iframe[title="proto.html"]')
				.getByRole('heading', { name: 'Prototype' }),
		).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(viewer).toHaveCount(0);

		await tabs.filter({ hasText: 'Documents' }).click();
		await grid.getByRole('button', { name: /^notes\.md/u }).click();
		await expect(gallery).toHaveCount(0);
		await expect(page.getByRole('textbox', { name: 'Page address' })).toHaveValue(
			'./.context/notes.md',
		);

		placeInContext(worktree, 'review/later.png', readFixture('before.png'), 0);
		await page.getByRole('button', { name: 'Hide inspector' }).click();
		await expect(media).toHaveAccessibleName('Media 7 files', { timeout: 20_000 });
		await media.click();
		await expect(gallery).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(gallery).toHaveCount(0);

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('a workstream with nothing in .context shows no Media row until an agent saves a file there', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root, 'media-empty');
		const seeded = await seedWorkstream(page, source, 'e2e-media-empty', 'Media empty');
		mkdirSync(join(seeded.worktree, '.context'), { recursive: true });
		placeInContext(seeded.worktree, 'run.log', 'not media', 0);
		await openWorkstream(page, seeded.workstreamId);

		await expect(gutter(page).getByRole('button', { name: /^Changes/u })).toBeVisible({
			timeout: 20_000,
		});
		const media = gutter(page).getByRole('button', { name: /^Media/u });
		await expect(media).toHaveCount(0);

		placeInContext(seeded.worktree, 'shot.png', readFixture('after.png'), 0);
		await expect(media).toHaveAccessibleName('Media 1 file', { timeout: 20_000 });
		await captureFlow(app, 'media-gallery-gutter');

		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
