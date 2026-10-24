import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillRecord, TurnedOffSkills } from '$contract/skills';
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
import type { ClaudeConfigFiles } from './claude-settings';
import { registerSkills } from './register';

const NOW = '2026-10-15T00:00:00.000Z';

let db: MaliniDatabase;
let context: MainContext;
let folders: string[];
let claude: ClaudeConfigFiles;
const listSkills = vi.fn(async (cwd: string, _turnedOff: TurnedOffSkills): Promise<SkillRecord[]> =>
	skillsOf(cwd),
);

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
	const claudeHome = folder();
	claude = {
		settings: join(claudeHome, '.claude', 'settings.json'),
		state: join(claudeHome, '.claude.json'),
	};
	listSkills.mockClear();
	registerSkills(context, {
		listSkills,
		resolveCheckout: async (workstreamId) => `/checkouts/${workstreamId}`,
		claudeConfig: () => claude,
	});
	seedWorkstream('ws-1');
});

afterEach(() => {
	db.close();
	for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

describe('the skills a run gets', () => {
	it('gives a chat every skill, and a job session the skills of its job', () => {
		chooseSessionSkills(db, 'job-session', ['humanizer']);

		expect(skillsForRun(db, 'chat-session')).toBeNull();
		expect(skillsForRun(db, 'job-session')).toEqual(['humanizer']);
	});
});

describe('listing skills', () => {
	it('lists the skills of a workstream from its own checkout', async () => {
		const skills = await context.commands.call('skills.list', { workstreamId: 'ws-1' });

		expect(listSkills).toHaveBeenCalledWith('/checkouts/ws-1', { skills: [], plugins: [] });
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

	it('names the repositories a repository skill comes from', async () => {
		const first = folder();
		const second = folder();
		upsertConnectedRepository(db, {
			id: 'local:first',
			fullName: 'bestboyhq/first',
			defaultBranch: 'main',
			localPath: first,
			remoteUrl: null,
			createdAt: NOW,
		});
		upsertProject(db, { ...project(), id: 'second', name: 'second', repoPath: second });
		listSkills.mockImplementation(async () => [
			{ name: 'adr', description: 'Decide', source: 'repository', tokens: 128 },
			{ name: 'animate', description: 'Animate', source: 'personal', tokens: 315 },
		]);

		const skills = await context.commands.call('skills.list', {});
		listSkills.mockImplementation(async (cwd) => skillsOf(cwd));

		expect(skills).toEqual([
			{
				name: 'adr',
				description: 'Decide',
				source: 'repository',
				tokens: 128,
				repositories: ['first', 'second'],
			},
			{ name: 'animate', description: 'Animate', source: 'personal', tokens: 315 },
		]);
	});

	it('lists the skills Claude Code sees from the home folder when no repository is on disk', async () => {
		await context.commands.call('skills.list', {});

		expect(listSkills).toHaveBeenCalledWith(homedir(), { skills: [], plugins: [] });
	});

	it('asks Claude Code to list the skills and plugins the user turned off too', async () => {
		writeSettings({
			skillOverrides: { humanizer: 'off', adr: 'name-only' },
			enabledPlugins: { 'ponytail@ponytail': true, 'caveman@caveman': false },
		});

		await context.commands.call('skills.list', {});

		expect(listSkills).toHaveBeenCalledWith(homedir(), {
			skills: ['humanizer'],
			plugins: ['caveman@caveman'],
		});
	});
});

describe('turning skills off', () => {
	it('reports how often Claude Code used each skill and what is turned off', async () => {
		writeFileSync(
			claude.state,
			JSON.stringify({
				firstStartTime: '2026-06-30T10:35:42.832Z',
				skillUsage: {
					adr: { usageCount: 25, lastUsedAt: Date.parse('2026-10-16T09:00:00.000Z') },
					broken: { usageCount: 'many' },
				},
			}),
		);
		writeSettings({
			skillOverrides: { humanizer: 'off' },
			enabledPlugins: { 'ponytail@ponytail': true, 'caveman@caveman': false, local: true },
		});

		expect(await context.commands.call('skills.usage', undefined)).toEqual({
			since: '2026-06-30T10:35:42.832Z',
			uses: [{ name: 'adr', uses: 25, lastUsedAt: '2026-10-16T09:00:00.000Z' }],
			turnedOff: ['humanizer'],
			plugins: [
				{ id: 'ponytail@ponytail', name: 'ponytail', on: true },
				{ id: 'caveman@caveman', name: 'caveman', on: false },
			],
		});
	});

	it('reports nothing used and nothing off before Claude Code wrote either file', async () => {
		expect(await context.commands.call('skills.usage', undefined)).toEqual({
			since: null,
			uses: [],
			turnedOff: [],
			plugins: [],
		});
	});

	it('turns a skill off and on in the settings file, keeping everything else in it', async () => {
		writeSettings({ theme: 'dark', hooks: { Stop: [] } });

		const off = await context.commands.call('skills.switch', {
			kind: 'skill',
			name: 'humanizer',
			on: false,
		});
		expect(off.turnedOff).toEqual(['humanizer']);
		expect(settings()).toEqual({
			theme: 'dark',
			hooks: { Stop: [] },
			skillOverrides: { humanizer: 'off' },
		});
		expect(readFileSync(claude.settings, 'utf8').endsWith('}\n')).toBe(true);

		await context.commands.call('skills.switch', { kind: 'skill', name: 'humanizer', on: true });
		expect(settings()).toEqual({ theme: 'dark', hooks: { Stop: [] } });
	});

	it('turns a whole plugin off, and only one the settings already name', async () => {
		writeSettings({ enabledPlugins: { 'ponytail@ponytail': true } });

		await context.commands.call('skills.switch', {
			kind: 'plugin',
			name: 'ponytail@ponytail',
			on: false,
		});
		expect(settings()).toEqual({ enabledPlugins: { 'ponytail@ponytail': false } });
		await expect(
			context.commands.call('skills.switch', { kind: 'plugin', name: 'other@market', on: false }),
		).rejects.toThrow(/not in your Claude Code settings/u);
	});

	it('writes through a symlinked settings file and leaves the link in place', async () => {
		const dotfiles = folder();
		const target = join(dotfiles, 'settings.json');
		writeFileSync(target, '{}\n');
		mkdirSync(join(claude.settings, '..'), { recursive: true });
		symlinkSync(target, claude.settings);

		await context.commands.call('skills.switch', { kind: 'skill', name: 'dataviz', on: false });

		expect(lstatSync(claude.settings).isSymbolicLink()).toBe(true);
		expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({
			skillOverrides: { dataviz: 'off' },
		});
	});

	it('refuses to touch a settings file that is not JSON, and switches that make no sense', async () => {
		mkdirSync(join(claude.settings, '..'), { recursive: true });
		writeFileSync(claude.settings, '{ "theme": ');

		await expect(
			context.commands.call('skills.switch', { kind: 'skill', name: 'adr', on: false }),
		).rejects.toThrow(/not valid JSON/u);
		expect(readFileSync(claude.settings, 'utf8')).toBe('{ "theme": ');

		for (const args of [
			{ kind: 'skill', name: 'ponytail:ponytail', on: false },
			{ kind: 'plugin', name: 'ponytail', on: false },
			{ kind: 'skill', name: 'adr', on: 'no' },
			{ kind: 'agent', name: 'adr', on: false },
		]) {
			expect(await context.commands.invoke({ command: 'skills.switch', args })).toMatchObject({
				ok: false,
			});
		}
	});
});

function writeSettings(value: unknown): void {
	mkdirSync(join(claude.settings, '..'), { recursive: true });
	writeFileSync(claude.settings, JSON.stringify(value));
}

function settings(): unknown {
	return JSON.parse(readFileSync(claude.settings, 'utf8'));
}

function skillsOf(cwd: string): SkillRecord[] {
	const repository = cwd.split('/').filter(Boolean).at(-2) ?? 'home';
	return [
		{ name: 'animate', description: 'Animate', source: 'personal', tokens: 315 },
		{ name: `${repository}-adr`, description: 'Decide', source: 'repository', tokens: 128 },
	];
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
		scope: null,
		startedBy: null,
	});
}
