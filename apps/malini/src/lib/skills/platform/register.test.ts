import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillChoice, SkillRecord } from '$contract/skills';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { openMigratedDatabase } from '$main/db/open';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import {
	upsertConnectedRepository,
	upsertProject,
	upsertWorkstream,
} from '$shared/repositories/repositories.platform';
import { chooseSessionSkills, skillsForRun } from '../skills.platform';
import { registerSkills } from './register';

const NOW = '2026-10-15T00:00:00.000Z';

let db: MaliniDatabase;
let context: MainContext;
let folders: string[];
const listSkills = vi.fn(async (cwd: string): Promise<SkillRecord[]> => skillsOf(cwd));

beforeEach(() => {
	db = openMigratedDatabase(':memory:');
	context = {
		db,
		commands: new CommandRegistry(),
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot: '/tmp/malini',
		resourcesRoot: '/tmp/malini',
		isDev: false,
		appVersion: '0.0.0',
	};
	folders = [];
	listSkills.mockClear();
	registerSkills(context, {
		listSkills,
		resolveCheckout: async (workstreamId) => `/checkouts/${workstreamId}`,
	});
	seedWorkstream('ws-1');
});

afterEach(() => {
	db.close();
	for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

describe('skill presets', () => {
	it('saves, renames and deletes a preset, keeping each skill once', async () => {
		const builder = await savePreset({ name: ' Builder ', skills: ['adr', 'animate', 'adr'] });
		expect(builder).toMatchObject({
			name: 'Builder',
			skills: ['adr', 'animate'],
			isDefault: false,
		});

		const renamed = await savePreset({ id: builder.id, name: 'Frontend', skills: ['animate'] });
		expect(renamed).toMatchObject({ id: builder.id, name: 'Frontend', skills: ['animate'] });
		expect(await presets()).toEqual([renamed]);

		await context.commands.call('skills.delete-preset', { presetId: builder.id });
		expect(await presets()).toEqual([]);
	});

	it('keeps one default preset at a time and clears it on request', async () => {
		const builder = await savePreset({ name: 'Builder', skills: [] });
		const marketer = await savePreset({ name: 'Marketer', skills: [] });

		await context.commands.call('skills.set-default-preset', { presetId: builder.id });
		const after = await context.commands.call('skills.set-default-preset', {
			presetId: marketer.id,
		});
		expect(after.map(({ name, isDefault }) => [name, isDefault])).toEqual([
			['Builder', false],
			['Marketer', true],
		]);

		await context.commands.call('skills.set-default-preset', { presetId: null });
		expect((await presets()).some(({ isDefault }) => isDefault)).toBe(false);
	});

	it('refuses a nameless preset, a list that is not skill names, and an unknown preset', async () => {
		await expect(savePreset({ name: '  ', skills: [] })).rejects.toThrow(/name/u);
		expect(
			await context.commands.invoke({
				command: 'skills.save-preset',
				args: { name: 'Builder', skills: 'adr' },
			}),
		).toMatchObject({ ok: false, error: expect.stringMatching(/skills/u) });
		await expect(
			context.commands.call('skills.delete-preset', { presetId: 'missing' }),
		).rejects.toThrow(/not found/u);
	});
});

describe('the skills a run gets', () => {
	it('gets every skill until a default preset exists, then that preset', async () => {
		expect(skillsForRun(db, 'ws-1', 'session-1')).toBeNull();

		const builder = await savePreset({ name: 'Builder', skills: ['adr', 'animate'] });
		await context.commands.call('skills.set-default-preset', { presetId: builder.id });

		expect(skillsForRun(db, 'ws-1', 'session-1')).toEqual(['adr', 'animate']);
	});

	it('follows the workstream choice, and the default again when its preset is deleted', async () => {
		const builder = await savePreset({ name: 'Builder', skills: ['adr'] });
		const marketer = await savePreset({ name: 'Marketer', skills: ['humanizer'] });
		await context.commands.call('skills.set-default-preset', { presetId: builder.id });

		await choose({ kind: 'preset', presetId: marketer.id });
		expect(skillsForRun(db, 'ws-1', 'session-1')).toEqual(['humanizer']);

		await choose({ kind: 'custom', skills: ['adr', 'humanizer', 'adr'] });
		expect(skillsForRun(db, 'ws-1', 'session-1')).toEqual(['adr', 'humanizer']);

		await choose({ kind: 'all' });
		expect(skillsForRun(db, 'ws-1', 'session-1')).toBeNull();

		await choose({ kind: 'preset', presetId: marketer.id });
		await context.commands.call('skills.delete-preset', { presetId: marketer.id });
		expect(skillsForRun(db, 'ws-1', 'session-1')).toEqual(['adr']);
	});

	it('gives a session with its own choice, like a job, its own skills', async () => {
		const marketer = await savePreset({ name: 'Marketer', skills: ['humanizer'] });
		chooseSessionSkills(db, 'job-session', { kind: 'preset', presetId: marketer.id });
		await choose({ kind: 'custom', skills: ['adr'] });

		expect(skillsForRun(db, 'ws-1', 'job-session')).toEqual(['humanizer']);
		expect(skillsForRun(db, 'ws-1', 'chat-session')).toEqual(['adr']);
		expect(
			await context.commands.call('skills.choice', {
				workstreamId: 'ws-1',
				sessionId: 'job-session',
			}),
		).toEqual({ kind: 'preset', presetId: marketer.id });

		await choose({ kind: 'all' }, 'job-session');
		expect(skillsForRun(db, 'ws-1', 'job-session')).toBeNull();
		expect(skillsForRun(db, 'ws-1', 'chat-session')).toEqual(['adr']);
	});

	it('refuses a choice that is not one, and a workstream that does not exist', async () => {
		await expect(
			context.commands.call('skills.choose', {
				workstreamId: 'ws-1',
				choice: { kind: 'preset', presetId: '' },
			}),
		).rejects.toThrow(/choice/u);
		await expect(
			context.commands.call('skills.choice', { workstreamId: 'missing' }),
		).rejects.toThrow(/not found/u);
	});
});

describe('listing skills', () => {
	it('lists the skills of a workstream from its own checkout', async () => {
		const skills = await context.commands.call('skills.list', { workstreamId: 'ws-1' });

		expect(listSkills).toHaveBeenCalledWith('/checkouts/ws-1');
		expect(skills.map(({ name }) => name)).toEqual(['animate', 'checkouts-adr']);
	});

	it('lists every repository once, keeping the first skill of each name', async () => {
		const first = folder();
		const second = folder();
		upsertConnectedRepository(db, {
			id: 'local:first',
			fullName: 'first',
			defaultBranch: 'main',
			localPath: first,
			remoteUrl: null,
			createdAt: NOW,
		});
		upsertProject(db, { ...project(), id: 'second', repoPath: second });
		upsertProject(db, { ...project(), id: 'first', repoPath: first });

		const skills = await context.commands.call('skills.list', {});

		expect(listSkills.mock.calls.map(([cwd]) => cwd).sort()).toEqual([first, second].sort());
		expect(skills.filter(({ name }) => name === 'animate')).toHaveLength(1);
	});

	it('lists the skills Claude Code sees from the home folder when no repository is on disk', async () => {
		await context.commands.call('skills.list', {});

		expect(listSkills).toHaveBeenCalledWith(homedir());
	});
});

function skillsOf(cwd: string): SkillRecord[] {
	const repository = cwd.split('/').filter(Boolean).at(-2) ?? 'home';
	return [
		{ name: 'animate', description: 'Animate', source: 'personal', tokens: 315 },
		{ name: `${repository}-adr`, description: 'Decide', source: 'repository', tokens: 128 },
	];
}

async function savePreset(args: { id?: string; name: string; skills: string[] }) {
	return context.commands.call('skills.save-preset', args);
}

async function presets() {
	return context.commands.call('skills.list-presets', undefined);
}

async function choose(choice: SkillChoice, sessionId?: string): Promise<SkillChoice> {
	return context.commands.call('skills.choose', {
		workstreamId: 'ws-1',
		choice,
		...(sessionId ? { sessionId } : {}),
	});
}

function folder(): string {
	const created = mkdtempSync(join(tmpdir(), 'malini-skills-'));
	folders.push(created);
	return created;
}

function project() {
	return {
		id: 'project',
		name: 'project',
		repoPath: '/tmp/project-that-is-not-on-disk',
		defaultBranch: 'main',
		createdAt: NOW,
	};
}

function seedWorkstream(workstreamId: string): void {
	upsertProject(db, project());
	upsertWorkstream(db, {
		id: workstreamId,
		projectId: 'project',
		name: workstreamId,
		path: `/tmp/${workstreamId}`,
		branch: `malini/${workstreamId}`,
		baseBranch: 'main',
		status: 'active',
		createdAt: NOW,
	});
}
