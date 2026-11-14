import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { environmentVariable, spawnable } from './command';

describe.runIf(process.platform === 'win32')('spawnable', () => {
	it('hands every argument through a batch file shim unchanged', () => {
		const folder = mkdtempSync(join(tmpdir(), 'malini-command-'));
		onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
		writeFileSync(
			join(folder, 'echo-args.js'),
			'process.stdout.write(JSON.stringify(process.argv.slice(2)))',
		);
		writeFileSync(
			join(folder, 'echo-args.cmd'),
			`@echo off\r\n"${process.execPath}" "%~dp0echo-args.js" %*\r\n`,
		);
		const inherited = Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'PATH');
		const env = {
			...Object.fromEntries(inherited),
			PATH: [folder, environmentVariable(process.env, 'PATH')].join(delimiter),
		};
		const args = [
			'plain',
			'two words',
			'"quoted"',
			'%PATH%',
			'a&b|c<d>e^f',
			'trailing\\',
			'!bang!',
			'--format=%s',
			'refs/heads/main:refs/heads/main',
			'',
		];

		const command = spawnable('echo-args', args, env);
		const result = spawnSync(command.file, command.args, {
			env,
			encoding: 'utf8',
			...command.options,
		});

		expect(JSON.parse(result.stdout)).toEqual(args);
	});
});
