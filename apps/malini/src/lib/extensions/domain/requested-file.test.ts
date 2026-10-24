import { describe, expect, it } from 'vitest';
import { readRequestedFiles, withoutRequestedFile, withRequestedFile } from './requested-file';

const alpha = { workstreamId: 'ws-1', path: 'alpha.ts', line: 3 };
const secrets = { workstreamId: 'ws-2', path: '/Users/someone/.secrets/app.keys', line: null };

describe('files an agent asked to open', () => {
	it('reads back only well-formed requests', () => {
		expect(
			readRequestedFiles([
				alpha,
				secrets,
				{ workstreamId: '', path: 'beta.ts', line: null },
				{ workstreamId: 'ws-1', path: 'gamma.ts', line: 0 },
				{ workstreamId: 'ws-1', line: null },
				'alpha.ts',
				null,
			]),
		).toEqual([alpha, secrets]);
		expect(readRequestedFiles({ alpha })).toEqual([]);
	});

	it('keeps one request per file, the latest, in the order they came in', () => {
		const beta = { workstreamId: 'ws-1', path: 'beta.ts', line: null };
		const alphaAgain = { ...alpha, line: 9 };
		expect(withRequestedFile(withRequestedFile([alpha], beta), alphaAgain)).toEqual([
			beta,
			alphaAgain,
		]);
		expect(withRequestedFile([alpha], { ...alpha, workstreamId: 'ws-2' })).toHaveLength(2);
	});

	it('forgets a request once it opened, but not a newer one for the same file', () => {
		const alphaAgain = { ...alpha, line: 9 };
		expect(withoutRequestedFile([alpha, secrets], alpha)).toEqual([secrets]);
		expect(withoutRequestedFile([alphaAgain, secrets], alpha)).toEqual([alphaAgain, secrets]);
	});
});
