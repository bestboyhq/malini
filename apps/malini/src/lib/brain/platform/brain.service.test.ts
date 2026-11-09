import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));

import type { AutomationRunRecord } from '$contract/automations';
import type { MainContext } from '$main/context';
import { openMigratedDatabase } from '$main/db/open';
import { run } from '$main/db/rows';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import { brainSetting, saveBrainSetting } from './brain-store.repository';
import { logDay } from './capture-log';
import { registerBrain } from './register';

function brainContext(): MainContext {
	const db = openMigratedDatabase(':memory:');
	run(
		db,
		`INSERT INTO automation_definitions
		   (id, name, instructions, model, effort, runs_in, builtin, trigger_when, trigger_mode,
		    created_at, updated_at)
		 VALUES ('capture', 'Capture to the log', 'Capture.', 'opus', 'low', 'workstream',
		         'capture-brain', 'on repositories:workstream-removed', 'auto', '', '')`,
	);
	saveBrainSetting(db, 'repository-id', 'brain-repository');
	return {
		db,
		commands: new CommandRegistry(),
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot: '/nowhere',
		checkoutsRoot: '/nowhere',
		resourcesRoot: '/nowhere',
		isDev: false,
		appVersion: '0.0.0',
	};
}

const waitingRun: AutomationRunRecord = {
	id: 'catch-up',
	definitionId: 'capture',
	title: 'Capture to the log',
	workstreamId: 'brain',
	repositoryId: null,
	scope: null,
	sessionId: null,
	agentRunId: null,
	origin: 'schedule',
	status: 'waiting',
	detail: null,
	parentRunId: null,
	chatSessionId: null,
	chatAfterRunId: null,
	chainId: 'catch-up',
	requests: 1,
	createdAt: '',
	startedAt: null,
	finishedAt: null,
};

describe('Brain catch-up', () => {
	it('tries again the same day when the catch-up run could not start', async () => {
		const context = brainContext();
		const asked: unknown[] = [];
		const failures: string[] = [];
		context.commands.define('automations.run', (args: unknown) => {
			asked.push(args);
			if (asked.length === 1) return Promise.reject(new Error('GitHub is offline'));
			return Promise.resolve(waitingRun);
		});
		const brain = registerBrain(context, {
			gh: () => Promise.reject(new Error('no gh here')),
			checkouts: {
				resolveCheckout: () => Promise.reject(new Error('no checkout')),
				resolveRepositoryRoot: () => Promise.reject(new Error('no repository')),
			},
			secrets: () => [],
			log: (line) => failures.push(line),
		});

		brain.start();
		await vi.waitFor(() => expect(failures).toHaveLength(1));
		brain.dispose();
		expect(failures[0]).toContain('could not catch up: GitHub is offline');
		expect(brainSetting(context.db, 'caught-up-on')).toBeNull();

		brain.start();
		await vi.waitFor(() => expect(asked).toHaveLength(2));
		brain.dispose();
		await vi.waitFor(() =>
			expect(brainSetting(context.db, 'caught-up-on')).toBe(logDay(new Date())),
		);
		context.db.close();
	});
});
