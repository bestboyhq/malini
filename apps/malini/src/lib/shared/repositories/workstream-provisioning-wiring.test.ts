import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
	return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const workstreamsLayout = source('../../app/presentation/layouts/WorkstreamsLayout.svelte');
const workstreamLayout = source('../../app/presentation/layouts/WorkstreamLayout.svelte');
const workstreamPage = source('../../app/presentation/pages/WorkstreamPage.svelte');
const sidebar = source('../../app/presentation/Sidebar.svelte');
const workstreamInspector = source('../../extensions/presentation/WorkstreamInspector.svelte');
const createWorkstreamForRepository = source(
	'./application/commands/create-workstream-for-repository.command.ts',
);
const provisionWorkstream = source('./application/commands/provision-workstream.command.ts');
const seedDependencies = source('./application/commands/seed-workstream-dependencies.command.ts');

describe('setup waiting on a GitHub credential', () => {
	it('resumes from the credential itself, not from the user pressing Retry again', () => {
		expect(workstreamsLayout).toContain('resumeProvisioningOnGithubCredentialHook(),');
		expect(workstreamsLayout).toContain(
			'for (const release of releases.splice(0).reverse()) release();',
		);
	});
});

describe('instant workstream creation contract', () => {
	it('navigates from the sidebar plus action before any scaffolding is awaited', () => {
		expect(workstreamsLayout).toContain('onNewWorkstream={createWorkstreamForRepositoryCommand}');
		expect(createWorkstreamForRepository).toContain('planWorkstreamProvisioning({');
		expect(createWorkstreamForRepository).toContain(
			'if (workstreamProvisioning.hasUnstartedAttemptForProject(plan.projectId)) return;',
		);
		const navigateAt = createWorkstreamForRepository.indexOf(
			'await goto(workstreamHref(plan.workstreamId));',
		);
		expect(navigateAt).toBeGreaterThan(-1);
		expect(navigateAt).toBeLessThan(
			createWorkstreamForRepository.indexOf('provisionWorkstreamCommand(plan);'),
		);
		expect(workstreamsLayout).not.toContain("toast.error('Could not create workstream'");
		expect(workstreamsLayout).not.toContain('createProjectCommand');
		expect(workstreamsLayout).not.toContain('createWorkstream(');
		expect(workstreamsLayout).not.toContain('creatingRepositoryId');
	});

	it('holds extension activation until the control plane returns a real path', () => {
		expect(workstreamPage).toContain(
			'const worktreePending = $derived(worktreePendingQuery.data(workstreamId));',
		);
		expect(workstreamPage).toContain('activationReady={repositoryScopeReady && !worktreePending}');
		expect(workstreamInspector).toContain(
			'const activationWorkstream = $derived(activationReady ? workstream : null);',
		);
		expect(workstreamPage).not.toContain(
			'const nextWorkstream = repositoryScopeReady ? publicExtensionWorkstream() : null;',
		);
	});

	it('lets the sidebar control remove a failed setup and refuse a mid-scaffold one', () => {
		expect(sidebar).toMatch(
			/import \{[^}]*\bworkstreamNativeExistenceQuery\b[^}]*\} from '\$shared\/repositories\/repositories\.api';/u,
		);
		expect(sidebar).toContain('data-workstream-lifecycle={lifecycle.kind}');
		expect(sidebar).toContain("lifecycle.kind === 'blocked'");
		expect(sidebar).toContain('lifecycle.archivesNatively');
		expect(sidebar).toContain("tooltip: 'Remove workstream'");
		expect(sidebar).toContain('Still setting up. Archive once setup finishes or fails.');
	});
});

describe('workstream dependency seeding contract', () => {
	it('is told its state rather than asking for it', () => {
		const listen = seedDependencies.indexOf('workstreamEventsService.onInstallStatus(');
		const invoke = seedDependencies.indexOf('provisionDependencies(workstreamId)');
		expect(listen).toBeGreaterThanOrEqual(0);
		expect(listen).toBeLessThan(invoke);
		expect(seedDependencies).toContain('workstreamDependencyInstall.report(payload)');
		expect(seedDependencies).not.toContain('setInterval');
		expect(seedDependencies).toContain(
			'workstreamDependencyInstall.settleFromOutcome(workstreamId, outcome);',
		);
		expect(seedDependencies.indexOf('settleFromOutcome(workstreamId, outcome)')).toBeLessThan(
			seedDependencies.indexOf('stopStatus();'),
		);
		expect(workstreamLayout).not.toContain('workstreamDependencyInstall.refresh');
	});

	it('seeds only after the worktree has settled', () => {
		const settle = provisionWorkstream.indexOf('workstreamProvisioning.settle(plan.workstreamId);');
		const seed = provisionWorkstream.indexOf(
			'seedWorkstreamDependenciesCommand(plan.workstreamId);',
		);
		expect(settle).toBeGreaterThanOrEqual(0);
		expect(settle).toBeLessThan(seed);
		expect(provisionWorkstream).not.toContain('await seedWorkstreamDependencies');
	});
});
