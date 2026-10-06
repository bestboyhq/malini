import { describe, expect, it } from 'vitest';
import { classifyFailure, describeFailure, sanitizeFailureDetail } from './failure-copy';

describe('classifyFailure', () => {
	it('calls a refused request refused, not unreachable', () => {
		expect(classifyFailure('GitHub request failed with status 401')).toBe('authorization');
		expect(classifyFailure('GitHub rejected the session: Unauthorized')).toBe('authorization');
		expect(
			describeFailure('GitHub request failed with status 401', {
				subject: 'Repositories',
			}).heading,
		).toBe('Authorization was refused');
	});

	it('reports a gateway error as it is, since there is no backend to blame', () => {
		expect(classifyFailure('502 Bad Gateway')).toBe('unknown');
		expect(classifyFailure('503 Service Unavailable')).toBe('unknown');
	});

	it('separates transport failures from authorization failures', () => {
		expect(classifyFailure('TypeError: Failed to fetch')).toBe('offline');
		expect(classifyFailure('getaddrinfo ENOTFOUND api.github.com')).toBe('offline');
		expect(classifyFailure('Request failed with status 401')).toBe('authorization');
		expect(classifyFailure('Bad credentials')).toBe('authorization');
	});

	it('recognizes throttling, timeouts, and missing resources', () => {
		expect(classifyFailure('API rate limit exceeded')).toBe('rate-limited');
		expect(classifyFailure('operation timed out after 30s')).toBe('timeout');
		expect(classifyFailure('repository not found')).toBe('missing');
	});

	it('falls back to unknown for messages it cannot place', () => {
		expect(classifyFailure('git exited with signal 9')).toBe('unknown');
		expect(classifyFailure(null)).toBe('unknown');
		expect(classifyFailure(undefined)).toBe('unknown');
	});

	it('does not let the word "authenticated" inside a 404 body win over 404', () => {
		expect(classifyFailure('403 Forbidden: resource not found')).toBe('authorization');
		expect(classifyFailure('404 not found')).toBe('missing');
	});
});

describe('sanitizeFailureDetail', () => {
	it('replaces managed repository storage paths', () => {
		const raw =
			'fatal: could not read /Users/ada/Library/Application Support/malini/repositories/acme-web/.git';
		expect(sanitizeFailureDetail(raw)).toBe('fatal: could not read managed repository storage');
	});

	it('replaces other absolute home paths without leaking the user name', () => {
		expect(sanitizeFailureDetail('ENOENT: /Users/ada/dev/malini/package.json')).toBe(
			'ENOENT: a local path',
		);
	});

	it('rewrites internal worktree vocabulary to workstream', () => {
		expect(sanitizeFailureDetail('worktree add failed; worktrees are locked')).toBe(
			'workstream add failed; workstreams are locked',
		);
	});

	it('collapses whitespace and truncates very long messages', () => {
		const long = `boom ${'x'.repeat(400)}`;
		const sanitized = sanitizeFailureDetail(long);
		expect(sanitized.length).toBe(220);
		expect(sanitized.endsWith('…')).toBe(true);
		expect(sanitizeFailureDetail('a\n\n  b\tc')).toBe('a b c');
	});

	it('returns an empty string for absent messages', () => {
		expect(sanitizeFailureDetail(null)).toBe('');
		expect(sanitizeFailureDetail(undefined)).toBe('');
		expect(sanitizeFailureDetail('   ')).toBe('');
	});
});

describe('describeFailure', () => {
	it('lowercases an ordinary subject inside a sentence but keeps proper nouns', () => {
		expect(describeFailure('Failed to fetch', { subject: 'Repositories' }).detail).toBe(
			'The request for repositories never left this device.',
		);
		expect(describeFailure('Failed to fetch', { subject: 'GitHub repositories' }).detail).toBe(
			'The request for GitHub repositories never left this device.',
		);
	});

	it('keeps the sanitized original as subordinate technical detail', () => {
		const copy = describeFailure(
			'fatal: unable to access /Users/ada/Library/Application Support/malini/repositories/x: 403',
			{ subject: 'Repositories' },
		);
		expect(copy.kind).toBe('authorization');
		expect(copy.technical).toBe('fatal: unable to access managed repository storage: 403');
	});

	it('promotes the sanitized message to the detail line when nothing else is known', () => {
		const copy = describeFailure('git exited with signal 9', { subject: 'Changed files' });
		expect(copy.kind).toBe('unknown');
		expect(copy.heading).toBe('Changed files could not load');
		expect(copy.detail).toBe('git exited with signal 9');
		expect(copy.technical).toBeNull();
	});

	it('never renders an empty detail line, even with no message at all', () => {
		const copy = describeFailure(null, { subject: 'Workstream data' });
		expect(copy.detail).toBe('malini did not report a reason.');
		expect(copy.remedy.length).toBeGreaterThan(0);
		expect(copy.technical).toBeNull();
	});

	it('always produces a non-empty heading, detail, and remedy for every kind', () => {
		const samples = [
			'502 Bad Gateway',
			'Failed to fetch',
			'401 unauthorized',
			'429 rate limit',
			'timed out',
			'404 not found',
			'something odd',
		];
		for (const sample of samples) {
			const copy = describeFailure(sample, { subject: 'Workstream data' });
			expect(copy.heading.trim().length).toBeGreaterThan(0);
			expect(copy.detail.trim().length).toBeGreaterThan(0);
			expect(copy.remedy.trim().length).toBeGreaterThan(0);
		}
	});
});
