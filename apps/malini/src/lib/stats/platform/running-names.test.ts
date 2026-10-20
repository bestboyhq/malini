import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	commandDetail,
	commandDirectory,
	fallbackServiceName,
	folderName,
	namingTask,
	nearestPackageName,
	parseServiceName,
	programName,
} from './running-names';

const WORKSTREAM = '/Users/me/malini/workstreams/ws-site';
const WRANGLER = `cd "${WORKSTREAM}/apps/site" && exec npx --yes wrangler@4 dev --port 8791 --local`;

describe('running names', () => {
	const folders: string[] = [];
	afterEach(() => {
		for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
	});

	it('tells the naming job what the command is', () => {
		expect(namingTask('Restart local site preview', WRANGLER, 'site')).toBe(
			`Description: Restart local site preview\nCommand: ${WRANGLER}\nPackage: site`,
		);
		expect(namingTask('Run the e2e suite', 'pnpm test:e2e', null)).toBe(
			'Description: Run the e2e suite\nCommand: pnpm test:e2e',
		);
	});

	it('reads a service or a task from the reply', () => {
		expect(parseServiceName('Site')).toEqual({ name: 'site', kind: 'service' });
		expect(parseServiceName('Render lab')).toEqual({ name: 'render lab', kind: 'service' });
		expect(parseServiceName('Task: e2e suite')).toEqual({ name: 'e2e suite', kind: 'task' });
		expect(parseServiceName('task:building release image')).toEqual({
			name: 'building release image',
			kind: 'task',
		});
		expect(parseServiceName('  ')).toBeNull();
		expect(parseServiceName('Task:')).toBeNull();
	});

	it('shows the command without its leading cd, and resolves where it runs', () => {
		expect(commandDetail(WRANGLER)).toBe('exec npx --yes wrangler@4 dev --port 8791 --local');
		expect(commandDetail('pnpm dev')).toBe('pnpm dev');
		expect(commandDirectory(WRANGLER, WORKSTREAM)).toBe(`${WORKSTREAM}/apps/site`);
		expect(commandDirectory('cd apps/web && pnpm dev', WORKSTREAM)).toBe(`${WORKSTREAM}/apps/web`);
		expect(commandDirectory('pnpm dev', WORKSTREAM)).toBe(WORKSTREAM);
	});

	it('names the program a command runs, past cds, env assignments and package runners', () => {
		expect(programName(WRANGLER)).toBe('wrangler');
		expect(programName('cd a && cd b && PORT=5173 NODE_ENV=dev pnpm exec vite --host')).toBe(
			'vite',
		);
		expect(programName('bun run playtest --serve')).toBe('playtest');
		expect(programName('./node_modules/.bin/Astro dev')).toBe('astro');
		expect(programName('npx @cloudflare/wrangler@3 dev')).toBe('wrangler');
		expect(programName('')).toBeNull();
		expect(fallbackServiceName(WRANGLER, 'site')).toBe('site');
		expect(fallbackServiceName(WRANGLER, null)).toBe('wrangler');
		expect(fallbackServiceName('', null)).toBe('command');
	});

	it('finds the nearest package name without its scope, never above the workstream', () => {
		const workstream = mkdtempSync(join(tmpdir(), 'malini-names-'));
		folders.push(workstream);
		mkdirSync(join(workstream, 'apps', 'site', 'src'), { recursive: true });
		mkdirSync(join(workstream, 'apps', 'docs'), { recursive: true });
		writeFileSync(join(workstream, 'package.json'), '{"name":"shop-workspace"}');
		writeFileSync(join(workstream, 'apps', 'site', 'package.json'), '{"name":"@shop/site"}');
		writeFileSync(join(workstream, 'apps', 'docs', 'package.json'), '{ broken');

		expect(nearestPackageName(join(workstream, 'apps', 'site', 'src'), workstream)).toBe('site');
		expect(nearestPackageName(join(workstream, 'apps', 'docs'), workstream)).toBe('shop-workspace');
		expect(nearestPackageName(workstream, workstream)).toBe('shop-workspace');
		expect(nearestPackageName(join(workstream, 'apps'), join(workstream, 'apps'))).toBeNull();
		expect(folderName(join(workstream, 'apps', 'site', 'src'), workstream)).toBe('site');
		expect(folderName(join(workstream, 'apps', 'docs'), workstream)).toBe('docs');
		expect(folderName(workstream, workstream)).toBe('shop-workspace');
	});
});
