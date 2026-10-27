import { setImmediate as nextTurn } from 'node:timers/promises';
import { REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL } from '$contract/events';
import type { MainContext } from '$main/context';
import type { MaliniDatabase } from '$main/db/driver';
import { describeError } from '$main/errors';
import {
	archivedSessionsToPack,
	liveSessionsToUnpack,
	packSessionEvents,
	unpackSessionEvents,
} from './event-packs.repository';

export interface ArchivedChatPacking {
	stop(): Promise<void>;
}

function attempt(what: string, work: () => void): void {
	try {
		work();
	} catch (error) {
		console.error(`malini: could not ${what}; the next start retries: ${describeError(error)}`);
	}
}

export function unpackRestoredChats(db: MaliniDatabase): void {
	attempt('unpack the chats of a restored workstream', () => {
		for (const sessionId of liveSessionsToUnpack(db)) unpackSessionEvents(db, sessionId);
	});
}

export function packArchivedChats({
	db,
	events,
}: Pick<MainContext, 'db' | 'events'>): ArchivedChatPacking {
	let stopped = false;
	let again = false;
	let pass: Promise<void> | null = null;

	const packEveryArchivedChat = async (): Promise<void> => {
		do {
			again = false;
			await nextTurn();
			unpackRestoredChats(db);
			for (const sessionId of archivedSessionsToPack(db)) {
				if (stopped) return;
				attempt(`pack archived chat \`${sessionId}\``, () => packSessionEvents(db, sessionId));
				await nextTurn();
			}
			attempt('give the space of packed chats back to the disk', () => db.releaseFreePages());
		} while (again && !stopped);
	};
	const schedulePass = (): void => {
		if (stopped) return;
		if (pass !== null) {
			again = true;
			return;
		}
		pass = (async () => {
			try {
				await packEveryArchivedChat();
			} catch (error) {
				console.error(
					`malini: packing archived chats stopped; the next start retries: ${describeError(error)}`,
				);
			} finally {
				pass = null;
			}
		})();
	};

	const unsubscribe = events.subscribe(REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL, schedulePass);
	schedulePass();

	return {
		async stop() {
			stopped = true;
			unsubscribe();
			await pass;
		},
	};
}
