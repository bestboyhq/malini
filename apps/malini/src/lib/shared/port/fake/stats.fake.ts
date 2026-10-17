import type { FakeBridge } from './fake-bridge';

export function installStatsFake(bridge: FakeBridge): void {
	bridge.define('stats.activity', async () => ({
		today: new Date().toISOString().slice(0, 10),
		runs: 0,
		jobRuns: 0,
		agentSeconds: 0,
		runningAgents: 0,
		days: [],
		repositories: [],
	}));
	bridge.define('stats.resources', async () => ({ machineMemoryBytes: 0, samples: [] }));
	bridge.define('stats.resource-breakdown', async () => []);
}
