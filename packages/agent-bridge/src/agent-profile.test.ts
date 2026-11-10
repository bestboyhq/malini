import { describe, expect, it } from 'vitest';
import { isAgentLineage, lineageDirectories } from './agent-profile.js';

const sibling = { repository: 'acme/web', branch: 'malini/w2', path: '/workstreams/w2' };

describe('isAgentLineage', () => {
	it('accepts a chat that started this workstream and its siblings', () => {
		expect(isAgentLineage({ startedBy: { name: 'Unify footers' }, siblings: [sibling] })).toBe(
			true,
		);
		expect(isAgentLineage({ startedBy: null, siblings: [] })).toBe(true);
	});

	it('rejects a starter without a name and a malformed sibling', () => {
		expect(isAgentLineage({ startedBy: { name: '' }, siblings: [] })).toBe(false);
		expect(isAgentLineage({ startedBy: {}, siblings: [] })).toBe(false);
		expect(isAgentLineage({ startedBy: null, siblings: [{ repository: 'acme/web' }] })).toBe(false);
	});
});

describe('lineageDirectories', () => {
	it('lists each sibling checkout once', () => {
		expect(
			lineageDirectories({ startedBy: { name: 'Unify footers' }, siblings: [sibling, sibling] }),
		).toEqual(['/workstreams/w2']);
		expect(lineageDirectories(undefined)).toEqual([]);
	});
});
