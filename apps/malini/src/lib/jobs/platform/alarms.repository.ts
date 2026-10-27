import type { AlarmTimeReached, ShippingWait } from '$contract/jobs';
import type { MaliniDatabase } from '$main/db/driver';
import { all, isRecord, run } from '$main/db/rows';

const WAITS: readonly ShippingWait[] = ['retry', 'checks'];

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

export function takeDueAlarms(db: MaliniDatabase, now: string): AlarmTimeReached[] {
	const due = all<{ key: string; due_at: string; payload: string }>(
		db,
		'SELECT key, due_at, payload FROM alarms WHERE due_at <= ? ORDER BY due_at',
		now,
	);
	for (const alarm of due) {
		run(db, 'DELETE FROM alarms WHERE key = ? AND due_at = ?', alarm.key, alarm.due_at);
	}
	return due.flatMap((alarm) => parsed(alarm.payload) ?? []);
}

function parsed(payload: string): AlarmTimeReached | null {
	try {
		const value: unknown = JSON.parse(payload);
		if (!isRecord(value)) return null;
		const { workstreamId, wait, due, sessionId, runId } = value;
		if (typeof workstreamId !== 'string' || typeof due !== 'string') return null;
		if (wait === 'resume') {
			return typeof sessionId === 'string' && typeof runId === 'string'
				? { workstreamId, sessionId, runId, wait, due }
				: null;
		}
		const known = WAITS.find((candidate) => candidate === wait);
		return known ? { workstreamId, wait: known, due } : null;
	} catch {
		return null;
	}
}
