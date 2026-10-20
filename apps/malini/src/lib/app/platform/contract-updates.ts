import {
	APP_UPDATED_CHANNEL,
	type ContractChanges,
	type ContractReference,
} from '$contract/events';
import type { MainContext } from '$main/context';
import { getSetting, setSetting } from './settings.repository';

export const LAST_SEEN_VERSION_SETTING = 'app.last-seen-version';

export const LAST_SEEN_CONTRACT_SETTING = 'app.last-seen-contract';

export type EventPayloads = Readonly<Record<string, string>>;

export function eventPayloads(reference: ContractReference): EventPayloads {
	return Object.fromEntries(reference.events.map(({ channel, payload }) => [channel, payload]));
}

export function contractChanges(before: EventPayloads, after: EventPayloads): ContractChanges {
	return {
		added: Object.keys(after).filter((channel) => !Object.hasOwn(before, channel)),
		removed: Object.keys(before).filter((channel) => !Object.hasOwn(after, channel)),
		changed: Object.entries(after).flatMap(([channel, payload]) => {
			const was = Object.hasOwn(before, channel) ? before[channel] : undefined;
			return was === undefined || was === payload ? [] : [{ channel, before: was, after: payload }];
		}),
	};
}

export function announceUpdate(
	{ db, events, appVersion }: Pick<MainContext, 'db' | 'events' | 'appVersion'>,
	reference: ContractReference,
): void {
	const from = getSetting(db, LAST_SEEN_VERSION_SETTING);
	const seen = storedPayloads(getSetting(db, LAST_SEEN_CONTRACT_SETTING));
	const current = eventPayloads(reference);
	setSetting(db, LAST_SEEN_VERSION_SETTING, appVersion);
	setSetting(db, LAST_SEEN_CONTRACT_SETTING, JSON.stringify(current));
	if (from === null || from === appVersion || seen === null) return;
	const changes = contractChanges(seen, current);
	if (changes.added.length + changes.removed.length + changes.changed.length === 0) return;
	events.emit(APP_UPDATED_CHANNEL, { from, to: appVersion, changes });
}

function storedPayloads(json: string | null): EventPayloads | null {
	if (json === null) return null;
	try {
		const parsed: unknown = JSON.parse(json);
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
		const entries: [string, unknown][] = Object.entries(parsed);
		const payloads = entries.filter(
			(entry): entry is [string, string] => typeof entry[1] === 'string',
		);
		return payloads.length === entries.length ? Object.fromEntries(payloads) : null;
	} catch {
		return null;
	}
}
