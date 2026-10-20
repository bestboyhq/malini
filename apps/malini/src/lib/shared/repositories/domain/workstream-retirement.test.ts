import { describe, expect, it } from 'vitest';
import { workstreamActionFailureMessage } from './workstream-action';
import { retirementFailureMessage, retirementFailureToast } from './workstream-retirement';

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
