import {
	DEFAULT_AGENT_ACCESS,
	isValidAgentAccess,
	type AgentAccess,
} from '$shared/providers/domain/run-profile';

const AGENT_ACCESS_DEFAULT_KEY = 'malini.providers.agent-access-default:v1';

class AgentAccessDefaultStorage {
	read(storage: Pick<Storage, 'getItem'> | null = browserStorage()): AgentAccess {
		try {
			const stored = storage?.getItem(AGENT_ACCESS_DEFAULT_KEY);
			return isValidAgentAccess(stored) ? stored : DEFAULT_AGENT_ACCESS;
		} catch {
			return DEFAULT_AGENT_ACCESS;
		}
	}

	write(access: AgentAccess, storage: Pick<Storage, 'setItem'> | null = browserStorage()): void {
		try {
			storage?.setItem(AGENT_ACCESS_DEFAULT_KEY, access);
		} catch {}
	}
}

export const agentAccessDefaultStorage = new AgentAccessDefaultStorage();

function browserStorage(): Storage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}
