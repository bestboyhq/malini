import { describe, expect, it } from 'vitest';
import { hasTurnReport, parseTurnReport } from './turn-report';

describe('turn report', () => {
	it('splits the footer the agent closes every turn with from the body above it', () => {
		const report = parseTurnReport(
			[
				'![Admin media tab](.malini/sandbox/screenshots/admin.png)',
				'',
				'- Uploads go to R2 in 50 MB chunks.',
				'- A 120 MB upload landed byte for byte.',
				'',
				'Outcome: Admin uploads videos to R2 and encodes them on GitHub.',
				'Needs: Add CLOUDFLARE_API_TOKEN to .env; Add the R2 keys to .env',
				'Commit: Guard admin with Cloudflare Access',
				'Pull request: Secure admin and add video encoding',
			].join('\n'),
		);

		expect(report).toEqual({
			outcome: 'Admin uploads videos to R2 and encodes them on GitHub.',
			needs: ['Add CLOUDFLARE_API_TOKEN to .env', 'Add the R2 keys to .env'],
			commit: 'Guard admin with Cloudflare Access',
			pullRequest: 'Secure admin and add video encoding',
			images: [{ alt: 'Admin media tab', src: '.malini/sandbox/screenshots/admin.png' }],
			details: '- Uploads go to R2 in 50 MB chunks.\n- A 120 MB upload landed byte for byte.',
		});
		expect(hasTurnReport(report)).toBe(true);
	});

	it('reads nothing needed as no needs, and tolerates bold labels', () => {
		const report = parseTurnReport('**Outcome:** The header is sticky.\n**Needs:** nothing');

		expect(report.outcome).toBe('The header is sticky.');
		expect(report.needs).toEqual([]);
		expect(report.details).toBe('');
	});

	it('leaves a message without an outcome line as plain prose', () => {
		const text = 'Clean. Confirming the production guard.\n\nCommit: Fix the guard';
		const report = parseTurnReport(text);

		expect(hasTurnReport(report)).toBe(false);
		expect(report.commit).toBe('Fix the guard');
		expect(report.details).toBe('Clean. Confirming the production guard.');
	});

	it('keeps the resolved review threads a review job lists before the commit line in the footer', () => {
		const report = parseTurnReport(
			'Renamed the helper the bot flagged.\n\nOutcome: The review is addressed.\nNeeds: nothing\nResolved: PRRT_a1\nResolved: PRRT_b2\nCommit: Rename the helper',
		);

		expect(report.outcome).toBe('The review is addressed.');
		expect(report.commit).toBe('Rename the helper');
		expect(report.details).toBe('Renamed the helper the bot flagged.');
	});

	it('stops at the first prose line so a mid-body label stays in the body', () => {
		const report = parseTurnReport(
			'Outcome: drafted earlier\n\nThe real summary.\n\nOutcome: Shipped the fix.\nNeeds: nothing',
		);

		expect(report.outcome).toBe('Shipped the fix.');
		expect(report.details).toBe('Outcome: drafted earlier\n\nThe real summary.');
	});
});
