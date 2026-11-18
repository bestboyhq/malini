import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { throwSite } from './throw-site';

const app = mkdtempSync(join(tmpdir(), 'malini-throw-site-'));
const bundle = join(app, 'out', 'main', 'index.js');
mkdirSync(join(app, 'out', 'main'), { recursive: true });
writeFileSync(bundle, '');
writeFileSync(
	`${bundle}.map`,
	JSON.stringify({
		version: 3,
		sources: [
			'../../src/lib/chat/platform/mcp-servers.ts',
			'../../src/main/errors.ts',
			'../../../../node_modules/.pnpm/dep@1.0.0/node_modules/dep/index.js',
		],
		names: [],
		mappings: 'AC4FA;ADsKA;AElQA',
	}),
);

afterAll(() => rmSync(app, { recursive: true, force: true }));

function thrownAt(...frames: string[]): Error {
	const error = new Error('x');
	error.stack = ['Error: x', ...frames.map((frame) => `    at ${frame}`)].join('\n');
	return error;
}

describe('throw site', () => {
	it('maps the bundle back to the first app line, past dependencies and error factories', () => {
		const error = thrownAt(
			'node:internal/process/task_queues:105:5',
			`dep (${bundle}:3:1)`,
			`GitError.commandFailed (${bundle}:1:1)`,
			`async watch (${pathToFileURL(bundle).href}:2:1)`,
		);
		expect(throwSite(error)).toBe('lib/chat/platform/mcp-servers.ts:259');
	});

	it('names a source frame by its path inside the app, never the folder around it', () => {
		const error = thrownAt('read (/Users/me/clients/acme/apps/malini/src/main/git/run.ts:12:3)');
		expect(throwSite(error)).toBe('main/git/run.ts:12');
	});

	it('has no site for a throw that never passed through app code', () => {
		expect(throwSite(thrownAt('node:fs:448:20'))).toBeNull();
		expect(throwSite('a string')).toBeNull();
	});
});
