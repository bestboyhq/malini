import { describe, expect, it } from 'vitest';

import {
	classifyPromptDispatchFailure,
	isAlreadyActiveError,
	isCancelRaceError,
	type PromptDispatchStage,
} from './prompt-dispatch-failure';

const ALREADY_RUNNING = 'work stream `ws-a` already has an active run';
const CANCEL_RACE = 'cancel race: no active run for session';
const CANCEL_PERSISTENCE_TIMEOUT =
	'cancel persistence timeout: owned loop acknowledged cancellation, but SQLite did not show a persisted run.failed within 4000ms for: run-a';
const PROCESS_REPLACEMENT_PENDING =
	'Agent candidate launch is in progress; queue this prompt and retry shortly';
const WORKSTREAM_TEARDOWN_PENDING = 'work stream `ws-a` is being archived or deleted';
const SUPERVISOR_TIMEOUT = 'bridge unavailable: command cmd-7 was not acknowledged within 5000ms';

const EVERY_STAGE: readonly PromptDispatchStage[] = [
	'prepare-session',
	'prepare-stream',
	'deliver',
	'cancel',
];

describe('isAlreadyActiveError', () => {
	it('matches the rendered AlreadyRunning message case-insensitively', () => {
		expect(isAlreadyActiveError(ALREADY_RUNNING)).toBe(true);
		expect(isAlreadyActiveError('Work stream `ws-a` ALREADY HAS AN ACTIVE RUN')).toBe(true);
	});

	it('does not match any other lifecycle message', () => {
		expect(isAlreadyActiveError(CANCEL_RACE)).toBe(false);
		expect(isAlreadyActiveError(PROCESS_REPLACEMENT_PENDING)).toBe(false);
		expect(isAlreadyActiveError('')).toBe(false);
	});
});

describe('isCancelRaceError', () => {
	it('matches the rendered CancelRace prefix case-insensitively', () => {
		expect(isCancelRaceError(CANCEL_RACE)).toBe(true);
		expect(isCancelRaceError('Cancel Race: no active run for session')).toBe(true);
	});

	it('does not match the neighbouring cancel-path messages', () => {
		expect(isCancelRaceError(CANCEL_PERSISTENCE_TIMEOUT)).toBe(false);
		expect(isCancelRaceError(ALREADY_RUNNING)).toBe(false);
		expect(isCancelRaceError('')).toBe(false);
	});
});

describe('classifyPromptDispatchFailure', () => {
	it('opts into the boot error screen only from the two preparation stages', () => {
		const classifications = EVERY_STAGE.map((stage) =>
			classifyPromptDispatchFailure({ stage, message: 'agent bridge restart failed' }),
		);

		expect(classifications).toEqual([
			'session-boot',
			'session-boot',
			'prompt-delivery',
			'prompt-delivery',
		]);
	});

	it('classifies every unknown message on a delivery or cancel stage as a prompt delivery failure', () => {
		for (const message of [
			CANCEL_PERSISTENCE_TIMEOUT,
			PROCESS_REPLACEMENT_PENDING,
			WORKSTREAM_TEARDOWN_PENDING,
			SUPERVISOR_TIMEOUT,
			'db error: database is locked',
		]) {
			expect(classifyPromptDispatchFailure({ stage: 'deliver', message })).toBe('prompt-delivery');
			expect(classifyPromptDispatchFailure({ stage: 'cancel', message })).toBe('prompt-delivery');
		}
	});

	it('recognizes the busy-workstream race on every stage', () => {
		for (const stage of EVERY_STAGE) {
			expect(classifyPromptDispatchFailure({ stage, message: ALREADY_RUNNING })).toBe(
				'already-running',
			);
		}
	});

	it('recognizes the cancel race on every stage', () => {
		for (const stage of EVERY_STAGE) {
			expect(classifyPromptDispatchFailure({ stage, message: CANCEL_RACE })).toBe('cancel-race');
		}
	});

	it('prefers the busy-workstream race when a message carries both signals', () => {
		expect(
			classifyPromptDispatchFailure({
				stage: 'cancel',
				message: `cancel race: ${ALREADY_RUNNING}`,
			}),
		).toBe('already-running');
	});

	it('reads an Error instance and a bare string identically', () => {
		for (const stage of EVERY_STAGE) {
			expect(classifyPromptDispatchFailure({ stage, message: new Error(ALREADY_RUNNING) })).toBe(
				classifyPromptDispatchFailure({ stage, message: ALREADY_RUNNING }),
			);
			expect(classifyPromptDispatchFailure({ stage, message: new Error(CANCEL_RACE) })).toBe(
				classifyPromptDispatchFailure({ stage, message: CANCEL_RACE }),
			);
			expect(classifyPromptDispatchFailure({ stage, message: new Error(SUPERVISOR_TIMEOUT) })).toBe(
				classifyPromptDispatchFailure({ stage, message: SUPERVISOR_TIMEOUT }),
			);
		}
	});

	it('reads a rejected plain object carrying a message field', () => {
		expect(
			classifyPromptDispatchFailure({ stage: 'deliver', message: { message: ALREADY_RUNNING } }),
		).toBe('already-running');
	});

	it('falls back to the stage when the message is empty, blank, or absent', () => {
		for (const stage of EVERY_STAGE) {
			const expected =
				stage === 'deliver' || stage === 'cancel' ? 'prompt-delivery' : 'session-boot';
			expect(classifyPromptDispatchFailure({ stage, message: '' })).toBe(expected);
			expect(classifyPromptDispatchFailure({ stage, message: '   ' })).toBe(expected);
			expect(classifyPromptDispatchFailure({ stage, message: undefined })).toBe(expected);
			expect(classifyPromptDispatchFailure({ stage, message: null })).toBe(expected);
		}
	});
});
