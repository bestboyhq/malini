import { APP_UPDATED_CHANNEL, type AppUpdatedPayload } from '$contract/events';
import type { MainContext } from '$main/context';
import { describeError } from '$main/errors';
import { listWorkstreams } from '$shared/repositories/repositories.platform';
import { getBuiltinJobDefinition } from './job-definitions.repository';

export function checkCompatibilityAfterUpdates(
	context: MainContext,
	log: (line: string) => void,
): () => void {
	return context.events.subscribe(APP_UPDATED_CHANNEL, (update) => {
		void checkCompatibility(context, update, log);
	});
}

async function checkCompatibility(
	{ db, commands }: MainContext,
	{ from, to, changes }: AppUpdatedPayload,
	log: (line: string) => void,
): Promise<void> {
	const definition = getBuiltinJobDefinition(db, 'check-compatibility');
	// ponytail: runs in the newest workstream of any repository; upgrade path: an app-level job target
	const [workstream] = listWorkstreams(db);
	if (!definition || !workstream) {
		log(
			`jobs: Malini updated from ${from} to ${to}, but there is no workstream to check compatibility in`,
		);
		return;
	}
	try {
		await commands.call('jobs.run', {
			definitionId: definition.id,
			workstreamId: workstream.id,
			context: JSON.stringify(changes, null, 2),
			origin: 'routine',
		});
	} catch (error) {
		log(
			`jobs: could not start ${definition.name} after the update to ${to}: ${describeError(error)}`,
		);
	}
}
