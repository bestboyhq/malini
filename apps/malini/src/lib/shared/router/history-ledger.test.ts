import { describe, expect, it } from 'vitest';
import { NavigationHistoryTargetLedger } from './history-ledger';

function state(historyIndex: number, navigationIndex = historyIndex): Record<string, number> {
	return {
		'malini:history': historyIndex,
		'malini:navigation': navigationIndex,
	};
}

describe('navigation history target ledger', () => {
	it('resolves exact adjacent entries across back and forward traversal', () => {
		const ledger = new NavigationHistoryTargetLedger();
		ledger.observeEntry(state(100), '/workstreams/a');
		ledger.reconcileAfterNavigate(state(101), '/workstreams/b?agent=session', 'link');
		ledger.reconcileAfterNavigate(state(102), '/workstreams/a', 'link');

		const back = ledger.adjacent('back', state(102));
		expect(back).toMatchObject({
			sourceIndex: 102,
			targetIndex: 101,
			targetUrl: '/workstreams/b?agent=session',
		});
		expect(back && ledger.isStillAdjacent(back, state(102))).toBe(true);

		ledger.recordPopstate(state(101), '/workstreams/b?agent=session');
		const forward = ledger.adjacent('forward', state(101));
		expect(forward).toMatchObject({ targetIndex: 102, targetUrl: '/workstreams/a' });
		expect(forward && ledger.confirmsPopstate(forward, state(102), '/workstreams/a')).toBe(true);
	});

	it('prunes a stale forward branch when a new route is pushed after Back', () => {
		const ledger = new NavigationHistoryTargetLedger();
		ledger.observeEntry(state(20), '/a');
		ledger.reconcileAfterNavigate(state(21), '/b', 'link');
		ledger.reconcileAfterNavigate(state(22), '/c', 'link');
		ledger.recordPopstate(state(20), '/a');
		ledger.reconcileAfterNavigate(state(21), '/replacement', 'link');

		expect(ledger.adjacent('back', state(21))?.targetUrl).toBe('/a');
		expect(ledger.adjacent('forward', state(21))).toBeNull();
		expect(ledger.snapshot().entries.map(({ targetUrl }) => targetUrl)).toEqual([
			'/a',
			'/replacement',
		]);
	});

	it('records shallow pushes and preserves forward entries on replace', () => {
		const ledger = new NavigationHistoryTargetLedger();
		ledger.observeEntry(state(7, 7), '/extensions');
		ledger.recordShallowCommit('push', state(8, 7), '/extensions/example');
		ledger.recordPopstate(state(7, 7), '/extensions');
		ledger.recordShallowCommit('replace', state(7, 7), '/extensions?filter=installed');

		expect(ledger.adjacent('forward', state(7, 7))?.targetUrl).toBe('/extensions/example');
		expect(ledger.snapshot().entries[0]?.targetUrl).toBe('/extensions?filter=installed');
	});

	it('refuses malformed, unknown, stale, and mismatched predictions', () => {
		const ledger = new NavigationHistoryTargetLedger();
		ledger.observeEntry({ 'malini:history': '1' }, '/ignored');
		expect(ledger.adjacent('back', null)).toBeNull();

		ledger.observeEntry(state(1), '/a');
		ledger.reconcileAfterNavigate(state(2), '/b', 'link');
		const back = ledger.adjacent('back', state(2));
		expect(back).not.toBeNull();
		expect(back && ledger.confirmsPopstate(back, state(1), '/wrong')).toBe(false);
		expect(back && ledger.confirmsPopstate(back, state(9), '/a')).toBe(false);
		ledger.recordPopstate(state(1), '/a');
		expect(back && ledger.isStillAdjacent(back, state(1))).toBe(false);
	});
});
