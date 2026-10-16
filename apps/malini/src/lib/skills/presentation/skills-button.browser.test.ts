import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, it, vi } from 'vitest';
import {
	installRepositoriesPlatform,
	provisioningPlan,
	resetRepositoriesState,
} from '$shared/repositories/application/provisioning.testkit';
import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';
import SkillsButton from './SkillsButton.svelte';

const WORKSTREAM = '01JSKILLSBUTTONNEWWORKSTREAM';

let app: ReturnType<typeof mount> | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
	if (app) void unmount(app, { outro: false });
	app = null;
	host?.remove();
	host = null;
	resetRepositoriesState();
});

it('asks for the skills of a new chat only once its workstream exists', async () => {
	const platform = installRepositoriesPlatform();
	const choiceRequests = (): number =>
		platform.calls.filter(({ command }) => command === 'skills.choice').length;
	workstreamProvisioning.begin(provisioningPlan(WORKSTREAM));
	workstreamProvisioning.advance(WORKSTREAM, 'worktree');

	host = document.createElement('div');
	document.body.append(host);
	app = mount(SkillsButton, { target: host, props: { workstreamId: WORKSTREAM, sessionId: null } });
	flushSync();
	await Promise.resolve();
	expect(choiceRequests()).toBe(0);

	workstreamProvisioning.settle(WORKSTREAM);
	flushSync();
	await vi.waitFor(() => expect(choiceRequests()).toBe(1));
});
