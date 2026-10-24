import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Workstream } from '$contract/repositories';
import { nowIso8601 } from '$main/db/rows';
import { runGit } from '$main/git/run';
import {
	LEAD_SPACE_BRANCH,
	LEAD_SPACE_PROJECT_ID,
	leadScopeKey,
	type LeadScope,
} from '../domain/lead-scope';
import { getProject, upsertProject } from './projects.repository';
import { createWorkstream, type WorkstreamsDeps } from './workstreams.service';
import { getWorkstream } from './workstreams.repository';

type LeadChat = Readonly<{ scope: LeadScope; workstreamId: string; name: string }>;

export function leadSpacePath(appDataRoot: string): string {
	return join(appDataRoot, 'lead-space');
}

export function createLeadSpace(deps: WorkstreamsDeps): (chat: LeadChat) => Promise<Workstream> {
	let ready: Promise<string> | null = null;
	const prepared = (): Promise<string> => {
		ready ??= prepareLeadSpace(deps).catch((error: unknown) => {
			ready = null;
			throw error;
		});
		return ready;
	};
	return async ({ scope, workstreamId, name }) => {
		const projectRepoPath = await prepared();
		await createWorkstream(deps, {
			projectRepoPath,
			workstreamId,
			baseBranch: LEAD_SPACE_BRANCH,
			projectId: LEAD_SPACE_PROJECT_ID,
			name,
			githubToken: null,
			startRef: LEAD_SPACE_BRANCH,
			scope: leadScopeKey(scope),
		});
		const lead = getWorkstream(deps.db, workstreamId);
		if (lead === null) throw new Error(`Malini could not record the chat \`${workstreamId}\`.`);
		return lead;
	};
}

async function prepareLeadSpace({ db, appDataRoot }: WorkstreamsDeps): Promise<string> {
	const repoPath = leadSpacePath(appDataRoot);
	if (!existsSync(join(repoPath, '.git'))) {
		await mkdir(repoPath, { recursive: true });
		await runGit(['-C', repoPath, 'init', '--quiet', '-b', LEAD_SPACE_BRANCH]);
	}
	await runGit(['-C', repoPath, 'config', 'core.hooksPath', '/dev/null']);
	if (!(await hasCommit(repoPath))) {
		await runGit([
			'-C',
			repoPath,
			'-c',
			'user.name=Malini',
			'-c',
			'user.email=malini@localhost',
			'-c',
			'commit.gpgsign=false',
			'commit',
			'--quiet',
			'--allow-empty',
			'-m',
			'Malini lead space',
		]);
	}
	if (getProject(db, LEAD_SPACE_PROJECT_ID)?.repoPath !== repoPath) {
		upsertProject(db, {
			id: LEAD_SPACE_PROJECT_ID,
			name: LEAD_SPACE_PROJECT_ID,
			repoPath,
			defaultBranch: LEAD_SPACE_BRANCH,
			createdAt: nowIso8601(),
		});
	}
	return repoPath;
}

async function hasCommit(repoPath: string): Promise<boolean> {
	try {
		await runGit([
			'-C',
			repoPath,
			'rev-parse',
			'--verify',
			'--quiet',
			`${LEAD_SPACE_BRANCH}^{commit}`,
		]);
		return true;
	} catch {
		return false;
	}
}
