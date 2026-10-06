import { describe, expect, it } from 'vitest';
import { workstreamActionFailureMessage } from './workstream-action';
import {
	retirementFailureMessage,
	retirementFailureToast,
	savedWorkNote,
} from './workstream-retirement';

describe('savedWorkNote', () => {
	it('uses "commit" without a number for one commit', () => {
		expect(savedWorkNote({ ref: 'refs/malini/archived/x', uncommitted: false, commits: 1 })).toBe(
			'Its commit is saved',
		);
	});

	it('uses "commit" without a number for one commit alongside uncommitted work', () => {
		expect(savedWorkNote({ ref: 'refs/malini/archived/x', uncommitted: true, commits: 1 })).toBe(
			'Its commit and uncommitted work are saved',
		);
	});

	it('uses the count for several commits', () => {
		expect(savedWorkNote({ ref: 'refs/malini/archived/x', uncommitted: false, commits: 3 })).toBe(
			'Its 3 commits are saved',
		);
	});

	it('omits the commit count when there are only uncommitted changes', () => {
		expect(savedWorkNote({ ref: 'refs/malini/archived/x', uncommitted: true, commits: 0 })).toBe(
			'Its uncommitted work is saved',
		);
	});
});

describe('why removing a workstream failed', () => {
	it('keeps the reason the platform gave, which arrives as plain text', () => {
		const reason = 'The checkout could not be moved out of the way, so nothing was removed: EACCES';

		expect(retirementFailureMessage(reason)).toBe(reason);
		expect(retirementFailureMessage(new Error(reason))).toBe(reason);
		expect(workstreamActionFailureMessage(reason, 'Delete failed')).toBe(reason);
	});

	it('falls back to a plain sentence when there is no reason', () => {
		expect(retirementFailureMessage(undefined)).toBe('The checkout could not be removed');
		expect(retirementFailureMessage('  ')).toBe('The checkout could not be removed');
		expect(workstreamActionFailureMessage(new Error(''), 'Delete failed')).toBe('Delete failed');
	});
});

describe('the toast for a failed archive or delete', () => {
	it('names the workstream and ends the reason as a sentence', () => {
		expect(
			retirementFailureToast(
				'archive',
				'Neon Circuit',
				'Saving its local work failed (git refused an ignored path), so nothing was removed',
			),
		).toBe(
			'Could not archive Neon Circuit · Saving its local work failed (git refused an ignored path), so nothing was removed.',
		);
		expect(
			retirementFailureToast('delete', 'Neon Circuit', 'It is already being archived or deleted.'),
		).toBe('Could not delete Neon Circuit · It is already being archived or deleted.');
	});
});
