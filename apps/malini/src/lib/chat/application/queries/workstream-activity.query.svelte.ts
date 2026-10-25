import { agentActivity } from '$lib/chat/infrastructure/aggregates/agent-activity.aggregate.svelte';
import { sessionsAggregate } from '$lib/chat/infrastructure/aggregates/sessions.aggregate.svelte';

export { workstreamActivityQuery };

class WorkstreamActivityQuery {
	public readonly activeAt: (workstreamId: string) => number | null = $derived.by(() => {
		const latest = new Map<string, number>();
		for (const session of sessionsAggregate.listSessions()) {
			if (session.origin === 'job') continue;
			const at = Math.max(
				Date.parse(session.startedAt) || 0,
				agentActivity.activeAtForChat(session.id) ?? 0,
			);
			latest.set(session.workstreamId, Math.max(latest.get(session.workstreamId) ?? 0, at));
		}
		return (workstreamId: string) => latest.get(workstreamId) || null;
	});
}

const workstreamActivityQuery = new WorkstreamActivityQuery();
