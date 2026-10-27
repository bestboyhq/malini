import type { MainContext } from '$main/context';
import { isRecord } from '$main/db/rows';
import { listWorkstreams } from '$shared/repositories/repositories.platform';
import { triggeredBefore } from './event-log.repository';
import { findString, type DispatchedEvent } from './event-log.service';
import { getBuiltinJobDefinition } from './job-definitions.repository';

export async function checkCompatibility(
	{ db, commands }: MainContext,
	event: DispatchedEvent,
	log: (line: string) => void,
): Promise<void> {
	const changes = isRecord(event.payload) ? event.payload['changes'] : null;
	if (!isRecord(changes)) return;
	const definition = getBuiltinJobDefinition(db, 'check-compatibility');
	// ponytail: runs in the newest workstream of any repository; upgrade path: an app-level job target
	const [workstream] = listWorkstreams(db);
	if (!definition || !workstream) {
		log(
			`jobs: Malini updated from ${findString(event.payload, 'from')} to ${findString(event.payload, 'to')}, but there is no workstream to check compatibility in`,
		);
		return;
	}
	if (triggeredBefore(db, definition.id, event.id)) return;
	await commands.call('jobs.run', {
		definitionId: definition.id,
		workstreamId: workstream.id,
		context: JSON.stringify(changes, null, 2),
		origin: 'compatibility',
		...(event.id === null ? {} : { causeEventId: event.id }),
	});
}
