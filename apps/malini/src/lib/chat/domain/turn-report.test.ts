import { describe, expect, it } from 'vitest';
import {
	hasTurnReport,
	isVideoPath,
	mediaMarker,
	mediaPath,
	parseTurnReport,
	turnStatus,
} from './turn-report';

describe('turn report', () => {
	it('splits the footer the agent closes every turn with from the body above it', () => {
		const text = [
			'![Admin media tab](.malini/sandbox/screenshots/admin.png)',
			'',
			'- Uploads go to R2 in 50 MB chunks.',
			'- A 120 MB upload landed byte for byte.',
			'',
			'Outcome: Admin uploads videos to R2 and encodes them on GitHub.',
			'Needs: Add CLOUDFLARE_API_TOKEN to .env; Add the R2 keys to .env',
			'Commit: Guard admin with Cloudflare Access',
			'Pull request: Secure admin and add video encoding',
		].join('\n');
		const report = parseTurnReport(text);

		expect(report).toEqual({
			outcome: 'Admin uploads videos to R2 and encodes them on GitHub.',
			needs: ['Add CLOUDFLARE_API_TOKEN to .env', 'Add the R2 keys to .env'],
			commit: 'Guard admin with Cloudflare Access',
			pullRequest: 'Secure admin and add video encoding',
			images: [{ alt: 'Admin media tab', src: '.malini/sandbox/screenshots/admin.png' }],
			comparison: null,
			variants: [],
			diagrams: [],
			notes: [
				{ kind: 'note', text: 'Uploads go to R2 in 50 MB chunks.' },
				{ kind: 'note', text: 'A 120 MB upload landed byte for byte.' },
			],
		});
		expect(hasTurnReport(text)).toBe(true);
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

		expect(hasTurnReport(text)).toBe(false);
		expect(hasTurnReport('Outcome:\nNeeds: nothing')).toBe(false);
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

	it('reads the labels on the bullets, and a deferral as a next step', () => {
		const report = parseTurnReport(
			[
				'- Changed: `merge-queue.ts` reruns a failed check once.',
				'- **Verified:** new cases pass,',
				'  including fail-twice.',
				'- Deferred: external CI statuses still park at once.',
				'- Next step: Rerun external statuses too',
				'',
				'Outcome: The merge queue reruns a failed check once.',
				'Needs: nothing',
			].join('\n'),
		);

		expect(report.notes).toEqual([
			{ kind: 'changed', text: '`merge-queue.ts` reruns a failed check once.' },
			{ kind: 'verified', text: 'new cases pass,\n  including fail-twice.' },
			{ kind: 'next', text: 'external CI statuses still park at once.' },
			{ kind: 'next', text: 'Rerun external statuses too' },
		]);
	});

	it('pairs a before and an after into one comparison and keeps the rest as images', () => {
		const report = parseTurnReport(
			[
				'![Before: pricing page](.context/before.png)',
				'![After: pricing page](.context/after.png)',
				'![Mobile](.context/mobile.png)',
				'',
				'Outcome: The Pro button leads.',
			].join('\n'),
		);

		expect(report.comparison).toEqual({
			before: { alt: 'pricing page', src: '.context/before.png' },
			after: { alt: 'pricing page', src: '.context/after.png' },
		});
		expect(report.images).toEqual([{ alt: 'Mobile', src: '.context/mobile.png' }]);
	});

	it('leaves a lone before, or a picture beside a recording, as plain images', () => {
		const lone = parseTurnReport('![Before: page](a.png)\n\nOutcome: Shown.');
		const mixed = parseTurnReport(
			'![Before: page](a.png)\n![After - page](b.mp4)\n\nOutcome: Shown.',
		);

		expect(lone.comparison).toBeNull();
		expect(lone.images).toHaveLength(1);
		expect(mixed.comparison).toBeNull();
		expect(mixed.images).toHaveLength(2);
	});

	it('reads variants with their names and notes once there are at least two', () => {
		const report = parseTurnReport(
			[
				'![Variant A: Calm - serif headline, lots of air](.context/a.png)',
				'![variant b: Bold](.context/b.png)',
				'![Variant B: Bold again](.context/b2.png)',
				'',
				'Outcome: Two hero directions.',
				'Needs: Pick a direction',
			].join('\n'),
		);
		const single = parseTurnReport('![Variant A: Calm](a.png)\n\nOutcome: One.');

		expect(report.variants).toEqual([
			{ id: 'A', name: 'Calm', note: 'serif headline, lots of air', src: '.context/a.png' },
			{ id: 'B', name: 'Bold', note: '', src: '.context/b.png' },
		]);
		expect(report.images).toEqual([]);
		expect(single.variants).toEqual([]);
		expect(single.images).toHaveLength(1);
	});

	it('tells a recording from a picture and reads the frame a recording marks', () => {
		expect(isVideoPath('.context/after.mp4#t=0.45')).toBe(true);
		expect(isVideoPath('.context/after.png')).toBe(false);
		expect(mediaPath('.context/after.mp4#t=0.45')).toBe('.context/after.mp4');
		expect(mediaMarker('.context/after.mp4#t=0.45')).toBe(0.45);
		expect(mediaMarker('.context/after.mp4')).toBeNull();
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
	});

	it('waits on the user only while the needs are open, and reads done otherwise', () => {
		const blocked = parseTurnReport('- Next: Notarize.\n\nOutcome: Built.\nNeeds: Add the key');

		expect(turnStatus(blocked, true)).toBe('waiting');
		expect(turnStatus(blocked, false)).toBe('done');
		expect(turnStatus(parseTurnReport('Outcome: Built.\nNeeds: nothing'), true)).toBe('done');
	});
});
