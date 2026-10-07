import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createTestHost } from '@malini/extension-api/test';
import { isRecord } from '../src/domain.js';
import extension from '../src/index.js';
import { activateThroughPullRequestRead } from './activation.js';

const manifest: unknown = JSON.parse(await readFile('manifest.json', 'utf8'));

test('activates, registers declared contributions, reloads, and cleans up', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: { name: 'contract', files: { 'README.md': 'repository' } },
	});
	try {
		await host.activate(extension);
		assert.deepEqual(host.snapshot().panels, [
			'malini.repository.file',
			'malini.repository.files-panel',
		]);
		assert.deepEqual(host.snapshot().commands, [
			'malini.repository.refresh',
			'malini.repository.refresh-pull-request',
			'malini.repository.prepare-pull-request-fix',
			'malini.repository.pull-latest',
			'malini.repository.continue-after-merge',
			'malini.repository.abort-operation',
			'malini.repository.mark-pull-request-ready',
			'malini.repository.select-file',
			'malini.repository.open-file',
			'malini.repository.render-diff',
			'malini.repository.open-agent-session-diff',
			'malini.repository.status',
			'malini.repository.commit-and-push',
			'malini.repository.create-or-open-pull-request',
			'malini.repository.request-merge-confirmation',
			'malini.repository.todos',
			'malini.repository.todo-add',
			'malini.repository.todo-toggle',
			'malini.repository.todo-remove',
			'malini.repository.warm-workstream',
		]);
		assert.equal(host.snapshot().settings['malini.repository.show-hidden'], false);
		await host.reload();
		assert.deepEqual(host.snapshot().panels, [
			'malini.repository.file',
			'malini.repository.files-panel',
		]);
		await host.deactivate();
		host.assertClean();
	} finally {
		await host.cleanup();
	}
});

test('invalid and duplicate manifest contributions fail contract validation', async () => {
	const valid = manifest as { contributes: { commands: readonly unknown[] } };
	const manifestRecord = isRecord(manifest) ? manifest : {};
	await assert.rejects(
		createTestHost({
			manifest: {
				...manifestRecord,
				contributes: {
					...(manifest as { contributes: Record<string, unknown> }).contributes,
					commands: [
						...valid.contributes.commands,
						{
							id: 'malini.repository.refresh',
							title: 'Duplicate refresh',
						},
					],
				},
			},
		}),
		/duplicate contribution id/u,
	);
});

test('replays the same lifecycle and command sequence deterministically', async () => {
	const fixtureRepository = { name: 'replay', files: { 'README.md': 'repository replay' } };
	const recordedHost = await createTestHost({ manifest, fixtureRepository });
	let recording: ReturnType<typeof recordedHost.recording> = [];
	try {
		await recordedHost.activate(extension);
		await recordedHost.invokeCommand('malini.repository.refresh');
		await recordedHost.invokeCommand('malini.repository.status');
		await recordedHost.deactivate();
		recordedHost.assertClean();
		recording = recordedHost.recording();
	} finally {
		await recordedHost.cleanup();
	}

	const replayHost = await createTestHost({ manifest, fixtureRepository, replay: recording });
	try {
		await replayHost.activate(extension);
		await replayHost.invokeCommand('malini.repository.refresh');
		await replayHost.invokeCommand('malini.repository.status');
		await replayHost.deactivate();
		replayHost.assertReplayComplete();
		replayHost.assertClean();
	} finally {
		await replayHost.cleanup();
	}
});

test('keeps the refresh command as one full repository read', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: { name: 'full-refresh-contract', files: { 'README.md': 'repository' } },
	});
	try {
		await activateThroughPullRequestRead(host, extension);
		const before = host.recording().length;
		await host.invokeCommand('malini.repository.refresh');
		const refreshReads = host
			.recording()
			.slice(before)
			.filter(({ kind }) =>
				[
					'repository.refresh',
					'repository.status',
					'repository.diff',
					'repository.pullRequest',
				].includes(kind),
			)
			.map(({ kind }) => kind)
			.sort();
		assert.deepEqual(refreshReads, [
			'repository.diff',
			'repository.diff',
			'repository.pullRequest',
			'repository.refresh',
			'repository.status',
		]);
		assert.deepEqual(
			host
				.recording()
				.slice(before)
				.filter(({ kind }) => kind === 'repository.diff')
				.map((entry) => (entry.payload as { scope?: string } | null)?.scope)
				.sort(),
			['branch', 'uncommitted'],
			'the two diff reads must ask for different scopes, not the same one twice',
		);

		await host.deactivate();
		host.assertClean();
	} finally {
		await host.cleanup();
	}
});

test('uses only the public extension API boundary', async () => {
	for (const sourcePath of ['src/index.ts', 'src/controller.ts', 'src/domain.ts', 'src/panel.ts']) {
		const source = await readFile(sourcePath, 'utf8');
		assert.doesNotMatch(source, /apps\/desktop|apps\/malini|\$lib|src\/main/u);
		assert.doesNotMatch(source, /from ['"]\.\.\/\.\.|from ['"]\/Users/u);
	}
	assert.match(await readFile('src/index.ts', 'utf8'), /from '@malini\/extension-api'/u);
});

test('rejects a merge confirmation that does not carry the confirmed head revision', async () => {
	const host = await createTestHost({
		manifest,
		fixtureRepository: { name: 'merge-confirmation-contract', files: { 'README.md': 'x' } },
	});
	try {
		await host.activate(extension);
		await assert.rejects(
			host.invokeCommand('malini.repository.request-merge-confirmation', { mergeMethod: 'squash' }),
			/confirmed pull request head revision/u,
		);
		await assert.rejects(
			host.invokeCommand('malini.repository.request-merge-confirmation', {
				expectedHeadSha: 'head-1',
				mergeMethod: 'octopus',
			}),
			/supported GitHub merge method/u,
		);
		await assert.rejects(
			host.invokeCommand('malini.repository.request-merge-confirmation', {
				expectedHeadSha: 'head-1',
				pullRequestNumber: 7,
			}),
			/Unsupported merge confirmation field/u,
		);
	} finally {
		await host.cleanup();
	}
});
