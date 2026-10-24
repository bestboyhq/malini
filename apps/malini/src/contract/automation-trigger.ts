import { EVENT_CHANNELS, isEventChannel, type EventChannel } from './events';

export type AutomationEventCondition = Readonly<{ path: string; equals: string | null }>;

export type ScheduleCadence =
	| 'day'
	| 'weekday'
	| 'monday'
	| 'tuesday'
	| 'wednesday'
	| 'thursday'
	| 'friday'
	| 'saturday'
	| 'sunday';

export type SchedulePlace =
	| Readonly<{ kind: 'home' }>
	| Readonly<{ kind: 'owner'; owner: string }>
	| Readonly<{ kind: 'repository'; repository: string }>;

export type Schedule = Readonly<{
	cadence: ScheduleCadence;
	hour: number;
	minute: number;
	place: SchedulePlace;
}>;

export type ScheduleTrigger = Schedule & Readonly<{ kind: 'schedule'; description: string }>;

export type AutomationTrigger =
	| Readonly<{ kind: 'manual'; description: string }>
	| Readonly<{ kind: 'workstream-created'; description: string }>
	| Readonly<{
			kind: 'resource-ready';
			description: string;
			dockerOnly: boolean;
			frontend: boolean;
	  }>
	| Readonly<{
			kind: 'event';
			channel: EventChannel;
			where: readonly AutomationEventCondition[];
			description: string;
	  }>
	| ScheduleTrigger;

export const MANUAL_AUTOMATION_PHRASE = 'when I run it';

export const SCHEDULE_CADENCES: readonly ScheduleCadence[] = [
	'day',
	'weekday',
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
	'sunday',
];

export const SCHEDULE_GRAMMAR =
	'every day, every weekday or every <day of the week> at <HH:MM>, optionally followed by in <owner> or in <owner>/<repository>';

const EVENT_PHRASE = /^on\s+(\S+:\S+)(?:\s+where\s+(.+))?$/iu;

const EVENT_CONDITION = /^([\w-]+(?:\.[\w-]+)*)\s+is\s+(.+)$/u;

const SCHEDULE_PHRASE =
	/^every\s+(\S+)\s+at\s+(\d{1,2}):(\d{2})(?:\s+in\s+([\w.-]+(?:\/[\w.-]+)?))?$/iu;

export function parseAutomationTrigger(when: string): AutomationTrigger {
	const event = EVENT_PHRASE.exec(when.trim());
	if (event) return parseEventTrigger(event[1] ?? '', event[2]);
	if (/^every\s/iu.test(when.trim())) return parseScheduleTrigger(when.trim());
	const normalized = when
		.trim()
		.toLocaleLowerCase()
		.replaceAll(/[-_]+/gu, ' ')
		.replaceAll(/\s+/gu, ' ');
	if (/\b(?:i run it|manual|manually|on demand)\b/u.test(normalized)) {
		return { kind: 'manual', description: 'Only when you run it' };
	}
	if (
		/\b(?:new\s+)?workstream\b/u.test(normalized) &&
		/\b(?:create|created|creation)\b/u.test(normalized)
	) {
		return { kind: 'workstream-created', description: 'When this workstream is created' };
	}
	const ready =
		/\b(?:boot|boots|booted|booting|ready|healthy|start|starts|started|starting|running|launch|launches|launched)\b/u.test(
			normalized,
		);
	const dockerOnly = /\b(?:docker|container)\b/u.test(normalized);
	const frontend = /\b(?:front end|frontend|web|client|ui)\b/u.test(normalized);
	const genericFrontendResource =
		frontend && /\b(?:resource|resources|service|services)\b/u.test(normalized);
	if (ready && (dockerOnly || genericFrontendResource)) {
		return {
			kind: 'resource-ready',
			description:
				dockerOnly && frontend
					? 'When a frontend Docker resource becomes ready'
					: dockerOnly
						? 'When a Docker resource becomes ready'
						: 'When a frontend resource becomes ready',
			dockerOnly,
			frontend,
		};
	}
	throw new Error(
		`Unsupported extension automation trigger ${JSON.stringify(when)}. Try “${MANUAL_AUTOMATION_PHRASE}”, “when a new workstream is created”, “when a frontend resource becomes ready”, “when a frontend Docker container becomes ready”, “on <channel>” for any platform event, like “on pull-requests:ship-changed where merged is set”, or a schedule, like “every weekday at 09:00”.`,
	);
}

export function scheduleWhen({ cadence, hour, minute, place }: Schedule): string {
	const where = place.kind === 'home' ? '' : ` in ${schedulePlaceName(place)}`;
	return `every ${cadence} at ${scheduleTime({ hour, minute })}${where}`;
}

export function scheduleTime({ hour, minute }: Pick<Schedule, 'hour' | 'minute'>): string {
	return `${twoDigits(hour)}:${twoDigits(minute)}`;
}

export function scheduleCadenceLabel(cadence: ScheduleCadence): string {
	if (cadence === 'day' || cadence === 'weekday') return `Every ${cadence}`;
	return `Every ${cadence.charAt(0).toUpperCase()}${cadence.slice(1)}`;
}

export function schedulePlaceName(place: SchedulePlace): string {
	if (place.kind === 'home') return 'Home';
	return place.kind === 'owner' ? place.owner : place.repository;
}

function parseScheduleTrigger(when: string): ScheduleTrigger {
	const match = SCHEDULE_PHRASE.exec(when);
	const cadence = SCHEDULE_CADENCES.find((known) => known === match?.[1]?.toLocaleLowerCase());
	const hour = Number(match?.[2]);
	const minute = Number(match?.[3]);
	if (!cadence || hour > 23 || minute > 59) {
		throw new Error(
			`Unsupported schedule ${JSON.stringify(when)}. Write ${SCHEDULE_GRAMMAR}, like “every weekday at 09:00 in bestboyhq”.`,
		);
	}
	const place = schedulePlace(match?.[4]);
	const description = `${scheduleCadenceLabel(cadence)} at ${hour}:${twoDigits(minute)}`;
	return { kind: 'schedule', cadence, hour, minute, place, description };
}

function schedulePlace(name: string | undefined): SchedulePlace {
	if (name === undefined) return { kind: 'home' };
	return name.includes('/')
		? { kind: 'repository', repository: name }
		: { kind: 'owner', owner: name };
}

function twoDigits(value: number): string {
	return String(value).padStart(2, '0');
}

function parseEventTrigger(channel: string, conditions: string | undefined): AutomationTrigger {
	if (!isEventChannel(channel)) throw new Error(unknownChannelMessage(channel));
	const where = (conditions?.split(/\s+and\s+/iu) ?? []).map(parseEventCondition);
	const clauses = where.map(({ path, equals }) =>
		equals === null ? `${path} is set` : `${path} is ${equals}`,
	);
	const [domain = '', name = ''] = channel.split(':');
	return {
		kind: 'event',
		channel,
		where,
		description: `When ${domain.replaceAll('-', ' ')} reports “${name.replaceAll('-', ' ')}”${clauses.length > 0 ? `, where ${clauses.join(' and ')}` : ''}`,
	};
}

function parseEventCondition(condition: string): AutomationEventCondition {
	const match = EVENT_CONDITION.exec(condition.trim());
	const path = match?.[1];
	const value = match?.[2]?.trim();
	if (!path || !value) {
		throw new Error(
			`Unsupported event condition ${JSON.stringify(condition.trim())}. Write “<field> is <value>” or “<field> is set”, like “merged is set”.`,
		);
	}
	return { path, equals: value === 'set' ? null : value };
}

function unknownChannelMessage(channel: string): string {
	const domain = channel.split(':')[0] ?? '';
	const sameDomain = EVENT_CHANNELS.filter((known) => known.startsWith(`${domain}:`));
	const domains = [...new Set(EVENT_CHANNELS.map((known) => known.split(':')[0]))];
	return sameDomain.length > 0
		? `Unknown event channel ${JSON.stringify(channel)}. ${domain} has ${sameDomain.join(', ')}.`
		: `Unknown event channel ${JSON.stringify(channel)}. Channels are <domain>:<event>, with domains ${domains.join(', ')}.`;
}
