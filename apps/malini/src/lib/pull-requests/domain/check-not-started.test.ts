import { describe, expect, it } from 'vitest';
import { checkNotStartedReason } from './check-not-started';

const BILLING =
	"The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings";

describe('checkNotStartedReason', () => {
	it("reads GitHub's reason for a job it never started, in plain words", () => {
		expect(
			checkNotStartedReason([
				{ level: 'notice', message: 'The ubuntu-latest label will migrate to Ubuntu 26.' },
				{ level: 'failure', message: BILLING },
			]),
		).toBe('recent account payments have failed or your spending limit needs to be increased');
		expect(
			checkNotStartedReason([
				{ level: 'failure', message: 'The job was not started because your account is locked' },
			]),
		).toBe('your account is locked');
	});

	it('finds nothing in the failures of a job that ran, or in a notice', () => {
		expect(
			checkNotStartedReason([
				{ level: 'failure', message: 'AssertionError: expected 2.25 to be less than 2' },
				{ level: 'notice', message: BILLING },
			]),
		).toBeNull();
		expect(checkNotStartedReason([])).toBeNull();
	});
});
