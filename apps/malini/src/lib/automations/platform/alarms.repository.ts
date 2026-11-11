import type { AlarmTimeReached, ShippingWait } from '$contract/automations';
import type { MaliniDatabase } from '$main/db/driver';
import { all, isRecord, run } from '$main/db/rows';

const WAITS: readonly ShippingWait[] = ['retry', 'checks', 'idle'];

export function setAlarm(db: MaliniDatabase, key: string, reached: AlarmTimeReached): void {
	run(
		db,
		`INSERT INTO alarms (key, due_at, payload) VALUES (?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET due_at = excluded.due_at, payload = excluded.payload`,
		key,
		reached.due,
		JSON.stringify(reached),
	);
}

export function clearAlarm(db: MaliniDatabase, key: string): void {
	run(db, 'DELETE FROM alarms WHERE key = ?', key);
}

export type DueAlarm = Readonly<{ key: string; dueAt: string; reached: AlarmTimeReached | null }>;

export function listDueAlarms(db: MaliniDatabase, now: string): DueAlarm[] {
	return all<{ key: string; due_at: string; payload: string }>(
		db,
		'SELECT key, due_at, payload FROM alarms WHERE due_at <= ? ORDER BY due_at',
		now,
	).map((alarm) => ({ key: alarm.key, dueAt: alarm.due_at, reached: parsed(alarm.payload) }));
}

export function takeAlarm(db: MaliniDatabase, { key, dueAt }: DueAlarm): void {
	run(db, 'DELETE FROM alarms WHERE key = ? AND due_at = ?', key, dueAt);
}

function parsed(payload: string): AlarmTimeReached | null {
	try {
		const value: unknown = JSON.parse(payload);
		if (!isRecord(value)) return null;
		const { workstreamId, wait, due, sessionId, runId, causeEventId } = value;
		if (typeof workstreamId !== 'string' || typeof due !== 'string') return null;
		if (wait === 'resume') {
			return typeof sessionId === 'string' && typeof runId === 'string'
				? { workstreamId, sessionId, runId, wait, due }
				: null;
		}
		const known = WAITS.find((candidate) => candidate === wait);
		if (!known) return null;
		return typeof causeEventId === 'number'
			? { workstreamId, wait: known, due, causeEventId }
			: { workstreamId, wait: known, due };
	} catch {
		return null;
	}
}
