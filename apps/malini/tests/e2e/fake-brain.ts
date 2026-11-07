import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSourceRepo, git, type LaunchedApp } from './harness';

export const FAKE_BRAIN = 'e2e-user/brain';

export type FakeBrainRepository = Readonly<{
	remote: string;
	mainLog(path: string): string;
	mainSubjects(): string[];
}>;

export async function brainOnGithub(
	app: LaunchedApp,
	visibility: 'private' | 'public' | 'missing',
): Promise<FakeBrainRepository> {
	const state = join(app.root, 'fake-brain');
	const url = `https://github.com/${FAKE_BRAIN}.git`;
	const remote = join(state, 'brain.git');
	mkdirSync(state, { recursive: true });
	const seed = await createSourceRepo(state, 'seed');
	await git(state, ['clone', '-q', '--bare', seed, remote]);
	if (visibility !== 'missing') {
		writeFileSync(join(state, 'visibility'), String(visibility === 'private'));
	}
	writeFileSync(
		join(state, 'created.json'),
		JSON.stringify({
			full_name: FAKE_BRAIN,
			clone_url: url,
			description: null,
			private: true,
			pushed_at: new Date().toISOString(),
		}),
	);
	const realGit = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();
	for (const dir of [join(app.home, '.local/bin'), app.bin]) {
		renameSync(join(dir, 'gh'), join(dir, 'gh-harness'));
		install(
			join(dir, 'gh'),
			`#!/bin/sh
case "$1 $2" in
  "api repos/${FAKE_BRAIN}")
    if [ -f "${state}/visibility" ]; then cat "${state}/visibility"; echo; exit 0; fi
    echo "gh: Not Found (HTTP 404)" 1>&2; exit 1 ;;
  "api --method")
    printf true > "${state}/visibility"; cat "${state}/created.json"; exit 0 ;;
esac
exec "${join(dir, 'gh-harness')}" "$@"
`,
		);
		install(
			join(dir, 'git'),
			`#!/bin/sh
exec "${realGit}" -c protocol.file.allow=always -c "url.${remote}.insteadOf=${url}" "$@"
`,
		);
	}
	const show = (args: readonly string[]): string =>
		execFileSync('git', ['-C', remote, ...args], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
	return {
		remote,
		mainLog: (path) => {
			try {
				return show(['show', `main:${path}`]);
			} catch {
				return '';
			}
		},
		mainSubjects: () => show(['log', '--format=%s', 'main']).split('\n').filter(Boolean),
	};
}

function install(path: string, script: string): void {
	writeFileSync(path, script);
	chmodSync(path, 0o755);
}
