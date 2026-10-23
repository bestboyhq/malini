import type { WorkstreamSetupStatusPayload } from '$contract/events';
import { SvelteSet } from 'svelte/reactivity';

class WorkstreamSetupAggregate {
	readonly #settingUp = new SvelteSet<string>();

	report({ workstreamId, status }: WorkstreamSetupStatusPayload): void {
		if (status === 'running') this.#settingUp.add(workstreamId);
		else this.#settingUp.delete(workstreamId);
	}

	isSettingUp(workstreamId: string): boolean {
		return this.#settingUp.has(workstreamId);
	}
}

export const workstreamSetup = new WorkstreamSetupAggregate();
