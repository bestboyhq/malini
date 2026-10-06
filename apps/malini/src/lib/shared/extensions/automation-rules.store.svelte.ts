import type { RoutineEvidence, RoutineOrigin, RoutineRun, RoutineStatus } from '$contract/routines';
import { invoke } from '$shared/port/invoke';

export type WorkstreamRoutineDefinition = Readonly<{
	id: string;
	status: RoutineStatus;
	origin: RoutineOrigin;
	label: string;
	when: string;
	run: RoutineRun;
	evidence: readonly RoutineEvidence[];
}>;

export type AutomationRuleFailure = Readonly<{
	workstreamId: string;
	ruleId: string;
	message: string;
}>;

export type AutomationRunOption = Readonly<{
	kind: 'workflow' | 'command';
	id: string;
	label: string;
}>;

export function workstreamRoutineDefinitions(
	records: readonly WorkstreamRoutineDefinition[],
): readonly WorkstreamRoutineDefinition[] {
	return records.map(({ id, status, origin, label, when, run, evidence }) => ({
		id,
		status,
		origin,
		label,
		when,
		run,
		evidence,
	}));
}

function sameRecords(
	left: readonly Record<string, unknown>[] | null,
	right: readonly Record<string, unknown>[] | null,
): boolean {
	if (left === right) return true;
	if (left === null || right === null) return false;
	if (left.length !== right.length) return false;
	return left.every((entry, index) => {
		const other = right[index];
		if (other === undefined) return false;
		const keys = Object.keys(entry);
		if (keys.length !== Object.keys(other).length) return false;
		return keys.every((key) => entry[key] === other[key]);
	});
}

class AutomationRulesStore {
	definitions = $state.raw<readonly WorkstreamRoutineDefinition[]>([]);
	failures = $state.raw<readonly AutomationRuleFailure[]>([]);
	runOptions = $state.raw<readonly AutomationRunOption[] | null>(null);

	publishDefinitions(definitions: readonly WorkstreamRoutineDefinition[]): void {
		if (sameRecords(this.definitions, definitions)) return;
		this.definitions = definitions;
	}

	publishFailures(failures: readonly AutomationRuleFailure[]): void {
		if (sameRecords(this.failures, failures)) return;
		this.failures = failures;
	}

	publishRunOptions(runOptions: readonly AutomationRunOption[] | null): void {
		if (sameRecords(this.runOptions, runOptions)) return;
		this.runOptions = runOptions;
	}
}

export const automationRulesStore = new AutomationRulesStore();

export async function loadAutomationRules(): Promise<readonly WorkstreamRoutineDefinition[]> {
	const records = await invoke('routines.list', undefined);
	const definitions = workstreamRoutineDefinitions(records);
	automationRulesStore.publishDefinitions(definitions);
	return definitions;
}
