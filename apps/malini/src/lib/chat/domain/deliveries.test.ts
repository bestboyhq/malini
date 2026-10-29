import { describe, expect, it } from 'vitest';
import type { WorkstreamReport } from '$contract/deliveries';
import {
	ASKED_PREAMBLE,
	deliveryBatch,
	parseWorkstreamReport,
	REPORTS_PREAMBLE,
	reportedTurnEnd,
	reportForLead,
	reportMedia,
	workstreamReport,
	type DeliveryItem,
} from './deliveries';
import { parseTurnReport } from './turn-report';

function report(workstreamId: string): WorkstreamReport {
	return {
		workstreamId,
		runId: `${workstreamId}-turn`,
		status: 'succeeded',
		outcome: 'Shipped it',
		needs: null,
		media: [],
	};
}

function item(
	kind: DeliveryItem['kind'],
	prompt: string,
	fields: Partial<DeliveryItem> = {},
): DeliveryItem {
	return {
		kind,
		prompt,
		fromWorkstreamId: null,
		report: null,
		decisionId: null,
		chainId: null,
		causeEventId: null,
		...fields,
	};
}

describe('deliveryBatch', () => {
	it('puts the reports first under the preamble, then the decision answers, then the prompts', () => {
		const batch = deliveryBatch([
			item('decision', 'Decided “Stack”: Svelte.', { decisionId: 'decision-1' }),
			item('prompt', 'Also add tests.', { fromWorkstreamId: 'lead', chainId: 'lead-turn' }),
			item('report', 'Api report', {
				fromWorkstreamId: 'api',
				report: report('api'),
				causeEventId: 7,
			}),
			item('prompt', 'Then ship it.', { fromWorkstreamId: 'lead' }),
			item('report', 'Site report', { fromWorkstreamId: 'site', report: report('site') }),
		]);

		expect(batch).toEqual({
			prompt: [
				REPORTS_PREAMBLE,
				'Api report',
				'Site report',
				'Decided “Stack”: Svelte.',
				'Also add tests.',
				'Then ship it.',
			].join('\n\n'),
			automated: false,
			from: 'lead',
			chainId: null,
			causeEventId: 7,
			reports: [report('api'), report('site')],
			decisions: ['decision-1'],
		});
	});

	it('is automated only when every item is a report, and keeps the first chain it meets', () => {
		expect(
			deliveryBatch([
				item('report', 'Api report', { fromWorkstreamId: 'api', report: report('api') }),
				item('report', 'Site report', {
					fromWorkstreamId: 'site',
					report: report('site'),
					chainId: 'lead-turn',
					causeEventId: 9,
				}),
			]),
		).toMatchObject({ automated: true, from: 'api', chainId: 'lead-turn', causeEventId: 9 });

		expect(deliveryBatch([item('prompt', 'Use the EU region.', { chainId: 'lead-turn' })])).toEqual(
			{
				prompt: 'Use the EU region.',
				automated: false,
				from: null,
				chainId: 'lead-turn',
				causeEventId: null,
				reports: [],
				decisions: [],
			},
		);
	});

	it('says work you asked for moved on when no report comes from a workstream you started', () => {
		const job = item('report', 'Fix checks, the job you ran, failed.');
		expect(deliveryBatch([job]).prompt).toBe(
			[ASKED_PREAMBLE, 'Fix checks, the job you ran, failed.'].join('\n\n'),
		);
		expect(
			deliveryBatch([job, item('report', 'Api report', { report: report('api') })]).prompt.split(
				'\n\n',
			)[0],
		).toBe(REPORTS_PREAMBLE);
	});

	it('collects only the reports and decision ids the items carry', () => {
		const batch = deliveryBatch([
			item('report', 'A report without its record'),
			item('decision', 'An answer without its decision'),
		]);
		expect(batch.reports).toEqual([]);
		expect(batch.decisions).toEqual([]);
		expect(batch.automated).toBe(false);
	});
});

describe('reportMedia', () => {
	it('names the variants, the after shot and each picture, leaving out what is not a checkout file', () => {
		const summary = [
			'![Variant A: Calm - soft colors](shots/a.png)',
			'![Variant B: Bold](shots/b.png)',
			'![Before: old header](shots/before.png)',
			'![After: new header](shots/after.png)',
			'![](shots/plain.png)',
			'![Remote](https://example.com/remote.png)',
			'',
			'Outcome: Restyled the header',
		].join('\n');

		expect(reportMedia(parseTurnReport(summary))).toEqual([
			{ src: 'shots/a.png', label: 'Variant A · Calm' },
			{ src: 'shots/b.png', label: 'Variant B · Bold' },
			{ src: 'shots/after.png', label: 'new header' },
			{ src: 'shots/plain.png', label: 'plain.png' },
		]);
	});

	it('labels an unnamed after shot After and keeps six pictures at most', () => {
		const comparison = '![Before:](shots/before.png)\n![After:](shots/after.png)';
		expect(reportMedia(parseTurnReport(comparison))).toEqual([
			{ src: 'shots/after.png', label: 'After' },
		]);

		const pictures = Array.from(
			{ length: 8 },
			(_, index) => `![Shot ${index}](shots/${index}.png)`,
		);
		expect(reportMedia(parseTurnReport(pictures.join('\n'))).map(({ label }) => label)).toEqual([
			'Shot 0',
			'Shot 1',
			'Shot 2',
			'Shot 3',
			'Shot 4',
			'Shot 5',
		]);
	});
});

describe('workstreamReport', () => {
	it('carries the turn and the pictures its summary embeds, and none without a summary', () => {
		const turn = {
			workstreamId: 'api',
			runId: 'api-turn',
			status: 'failed',
			outcome: 'Half done',
			needs: 'Which region?',
		} as const;

		expect(workstreamReport({ ...turn, summary: null, backgroundCommands: null })).toEqual({
			...turn,
			media: [],
		});
		expect(
			workstreamReport({
				...turn,
				summary: '![Chart](shots/chart.png)\n\nOutcome: Half done',
				backgroundCommands: null,
			}),
		).toEqual({ ...turn, media: [{ src: 'shots/chart.png', label: 'Chart' }] });
		expect(
			workstreamReport({ ...turn, summary: null, backgroundCommands: ['Dev server'] }),
		).toEqual({ ...turn, media: [], backgroundCommands: ['Dev server'] });
	});
});

describe('reportedTurnEnd', () => {
	it('says a turn finished or failed, or names the background commands it waits on', () => {
		expect(reportedTurnEnd({ status: 'succeeded' })).toBe('finished a turn');
		expect(reportedTurnEnd({ status: 'failed' })).toBe('failed its turn');
		expect(reportedTurnEnd({ status: 'succeeded', backgroundCommands: ['Wait for CI'] })).toBe(
			'is waiting on its background command “Wait for CI”, and reports again if it continues',
		);
		expect(
			reportedTurnEnd({ status: 'succeeded', backgroundCommands: ['Dev server', 'Watch'] }),
		).toBe(
			'is waiting on its background commands “Dev server” and “Watch”, and reports again if it continues',
		);
		expect(reportedTurnEnd({ status: 'succeeded', backgroundCommands: [] })).toBe(
			'is waiting on a background command, and reports again if it continues',
		);
	});
});

describe('parseWorkstreamReport', () => {
	it('reads a stored report back', () => {
		const stored = { ...report('api'), media: [{ src: 'shots/a.png', label: 'Chart' }] };
		expect(parseWorkstreamReport(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
		const waiting = { ...report('api'), backgroundCommands: ['Dev server'] };
		expect(parseWorkstreamReport(JSON.parse(JSON.stringify(waiting)))).toEqual(waiting);
	});

	it('refuses what is no report, and repairs the fields it can', () => {
		expect(parseWorkstreamReport(null)).toBeNull();
		expect(parseWorkstreamReport([report('api')])).toBeNull();
		expect(parseWorkstreamReport({ workstreamId: 'api' })).toBeNull();
		expect(parseWorkstreamReport({ runId: 'api-turn' })).toBeNull();

		expect(
			parseWorkstreamReport({
				workstreamId: 'api',
				runId: 'api-turn',
				status: 'exploded',
				outcome: 42,
				needs: ['a'],
				media: [{ src: 'shots/a.png', label: 'Chart' }, { src: 'shots/b.png' }, 'shots/c.png'],
				backgroundCommands: ['Dev server', 7, null],
			}),
		).toEqual({
			workstreamId: 'api',
			runId: 'api-turn',
			status: 'succeeded',
			outcome: null,
			needs: null,
			media: [{ src: 'shots/a.png', label: 'Chart' }],
			backgroundCommands: ['Dev server'],
		});
		expect(
			parseWorkstreamReport({ workstreamId: 'api', runId: 'api-turn', status: 'failed' }),
		).toMatchObject({ status: 'failed', media: [] });
	});
});

describe('reportForLead', () => {
	it('points each relative picture at the checkout and leaves the rest as written', () => {
		const summary =
			'See ![shot](shots/a.png), ![wrapped](<shots/b.png>), ![abs](/tmp/c.png), ![web](https://x.dev/d.png) and [docs](docs/e.md).';
		expect(reportForLead(summary, '/work/site')).toBe(
			'See ![shot](/work/site/shots/a.png), ![wrapped](</work/site/shots/b.png>), ![abs](/tmp/c.png), ![web](https://x.dev/d.png) and [docs](docs/e.md).',
		);
	});

	it('keeps a short report whole and cuts a long one to its head and its footer', () => {
		const short = 'Built it.\n\nOutcome: Built it';
		expect(reportForLead(short, '/work/site')).toBe(short);

		const long = `Head line\n${'x'.repeat(10_000)}\nOutcome: Built it\nNeeds: nothing`;
		const cut = reportForLead(long, '/work/site');
		expect(cut.startsWith('Head line\nxxx')).toBe(true);
		expect(cut).toContain('\n[…]\n');
		expect(cut.endsWith('\nOutcome: Built it\nNeeds: nothing')).toBe(true);
		expect(cut.length).toBeLessThan(6_100);
	});
});
