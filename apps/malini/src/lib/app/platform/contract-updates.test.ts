import { describe, expect, it } from 'vitest';
import {
	APP_UPDATED_CHANNEL,
	type AppUpdatedPayload,
	type ContractReference,
} from '$contract/events';
import { openMigratedDatabase } from '$main/db/open';
import { createEventBus } from '$main/events';
import { announceUpdate, contractChanges } from './contract-updates';

function reference(payloads: Readonly<Record<string, string>>): ContractReference {
	return {
		events: Object.entries(payloads).map(([channel, payload]) => ({
			channel,
			description: `${channel} happened.`,
			facts: [],
			payloadType: 'Payload',
			payload,
		})),
	};
}

function boot() {
	const db = openMigratedDatabase(':memory:');
	const events = createEventBus({ forwardToWindows: false });
	const updates: AppUpdatedPayload[] = [];
	events.subscribe(APP_UPDATED_CHANNEL, (update) => updates.push(update));
	const launch = (appVersion: string, contract: ContractReference): void =>
		announceUpdate({ db, events, appVersion }, contract);
	return { launch, updates };
}

const V1 = reference({ 'jobs:run-changed': 'type A = 1;', 'app:scale-changed': 'type E = {};' });
const V2 = reference({ 'jobs:run-changed': 'type A = 2;', 'app:updated': 'type U = {};' });

describe('contract changes', () => {
	it('lists the events added, removed and whose payload changed', () => {
		const before = { 'jobs:run-changed': 'type A = 1;', 'app:scale-changed': 'type E = {};' };
		const after = { 'jobs:run-changed': 'type A = 2;', 'app:updated': 'type U = {};' };

		expect(contractChanges(before, after)).toEqual({
			added: ['app:updated'],
			removed: ['app:scale-changed'],
			changed: [{ channel: 'jobs:run-changed', before: 'type A = 1;', after: 'type A = 2;' }],
		});
		expect(contractChanges(after, after)).toEqual({ added: [], removed: [], changed: [] });
	});
});

describe('announcing an update at boot', () => {
	it('stays silent on the first launch and announces a later version whose events changed', () => {
		const { launch, updates } = boot();

		launch('0.1.0', V1);
		expect(updates).toEqual([]);

		launch('0.2.0', V2);
		expect(updates).toEqual([
			{
				from: '0.1.0',
				to: '0.2.0',
				changes: {
					added: ['app:updated'],
					removed: ['app:scale-changed'],
					changed: [{ channel: 'jobs:run-changed', before: 'type A = 1;', after: 'type A = 2;' }],
				},
			},
		]);
	});

	it('stays silent when the new version kept every event as it was', () => {
		const { launch, updates } = boot();

		launch('0.1.0', V1);
		launch('0.2.0', V1);
		launch('0.3.0', V2);

		expect(updates.map(({ from, to }) => ({ from, to }))).toEqual([{ from: '0.2.0', to: '0.3.0' }]);
	});
});
