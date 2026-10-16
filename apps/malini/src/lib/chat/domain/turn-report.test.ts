import { describe, expect, it } from 'vitest';
import { hasTurnReport, leadNote, parseTurnReport, turnStatus } from './turn-report';

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
			diagrams: [],
			notes: [
				{ kind: 'note', text: 'Uploads go to R2 in 50 MB chunks.' },
				{ kind: 'note', text: 'A 120 MB upload landed byte for byte.' },
			],
		});
		expect(hasTurnReport(report)).toBe(true);
	});

	it('keeps image markdown quoted in code as text, not as a report image', () => {
		const body = [
			'The agent wrote `![...](/Users/me/Desktop/preview.png)` outside the worktree.',
			'',
			'```md',
			'![shot](a.png)',
			'```',
		].join('\n');
		const report = parseTurnReport(`${body}\n\nOutcome: Explained.`);

		expect(report.images).toEqual([]);
		expect(report.notes.map((note) => note.text)).toEqual([
			'The agent wrote `![...](/Users/me/Desktop/preview.png)` outside the worktree.',
			'```md\n![shot](a.png)\n```',
		]);
	});

	it('reads nothing needed as no needs, and tolerates bold labels', () => {
		const report = parseTurnReport('**Outcome:** The header is sticky.\n**Needs:** nothing');

		expect(report.outcome).toBe('The header is sticky.');
		expect(report.needs).toEqual([]);
		expect(report.notes).toEqual([]);
	});

	it('leaves a message without an outcome line as plain prose', () => {
		const text = 'Clean. Confirming the production guard.\n\nCommit: Fix the guard';
		const report = parseTurnReport(text);

		expect(hasTurnReport(report)).toBe(false);
		expect(report.commit).toBe('Fix the guard');
		expect(report.notes).toEqual([
			{ kind: 'note', text: 'Clean. Confirming the production guard.' },
		]);
	});

	it('keeps the resolved review threads a review job lists before the commit line in the footer', () => {
		const report = parseTurnReport(
			'Renamed the helper the bot flagged.\n\nOutcome: The review is addressed.\nNeeds: nothing\nResolved: PRRT_a1\nResolved: PRRT_b2\nCommit: Rename the helper',
		);

		expect(report.outcome).toBe('The review is addressed.');
		expect(report.commit).toBe('Rename the helper');
		expect(report.notes).toEqual([{ kind: 'note', text: 'Renamed the helper the bot flagged.' }]);
	});

	it('stops at the first prose line so a mid-body label stays in the body', () => {
		const report = parseTurnReport(
			'Outcome: drafted earlier\n\nThe real summary.\n\nOutcome: Shipped the fix.\nNeeds: nothing',
		);

		expect(report.outcome).toBe('Shipped the fix.');
		expect(report.notes.map((note) => note.text)).toEqual([
			'Outcome: drafted earlier',
			'The real summary.',
		]);
	});

	it('reads the labels on the bullets and leads with a deferral, then with the proof', () => {
		const report = parseTurnReport(
			[
				'- Changed: `merge-queue.ts` reruns a failed check once.',
				'- **Verified:** new cases pass,',
				'  including fail-twice.',
				'- Deferred: external CI statuses still park at once.',
				'',
				'Outcome: The merge queue reruns a failed check once.',
				'Needs: nothing',
			].join('\n'),
		);

		expect(report.notes).toEqual([
			{ kind: 'note', text: '`merge-queue.ts` reruns a failed check once.' },
			{ kind: 'verified', text: 'new cases pass,\n  including fail-twice.' },
			{ kind: 'deferred', text: 'external CI statuses still park at once.' },
		]);
		expect(leadNote(report.notes)?.kind).toBe('deferred');
		expect(leadNote(report.notes.slice(0, 2))?.kind).toBe('verified');
		expect(leadNote(report.notes.slice(0, 1))?.kind).toBe('note');
		expect(leadNote([])).toBeNull();
	});

	it('lifts the diagram that opens the body out of the notes', () => {
		const diagram = '```\nfails ──▶ rerun ──▶ merge\n```';
		const report = parseTurnReport(
			`${diagram}\n\n- Changed: reruns once.\n\n\`\`\`ts\nconst later = true;\n\`\`\`\n\nOutcome: Reruns once.`,
		);

		expect(report.diagrams).toEqual([diagram]);
		expect(report.notes.map((note) => note.text)).toEqual([
			'reruns once.',
			'```ts\nconst later = true;\n```',
		]);
		expect(leadNote(report.notes)?.text).toBe('reruns once.');
	});

	it('waits on the user only while the needs are open, and flags a deferral otherwise', () => {
		const blocked = parseTurnReport(
			'- Deferred: no notarization.\n\nOutcome: Built.\nNeeds: Add the key',
		);

		expect(turnStatus(blocked, true)).toBe('waiting');
		expect(turnStatus(blocked, false)).toBe('deferred');
		expect(turnStatus(parseTurnReport('Outcome: Built.\nNeeds: nothing'), true)).toBe('done');
	});
});
