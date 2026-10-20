import type { MainContext } from '$main/context';
import { describeError } from '$main/errors';
import {
	resolveEnvironment,
	writeEnvironmentDiagnostics,
	type ResolvedEnvironment,
} from '$main/process/environment';

export type { ResolvedEnvironment };

export async function resolveBootEnvironment(context: MainContext): Promise<ResolvedEnvironment> {
	const environment = await resolveEnvironment();
	try {
		writeEnvironmentDiagnostics(context.appDataRoot, environment);
	} catch (error) {
		console.error(`app: could not write the environment diagnostics: ${describeError(error)}`);
	}
	return environment;
}
