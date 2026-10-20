import { ghEnvironment } from '$main/process/gh';
import type { GitEnv } from './run';

export interface GitCredentialEnv {
	prepare(githubToken: string | null): Promise<GitEnv>;
}

export const GH_CREDENTIAL_HELPER_CONFIG = [
	'-c',
	'credential.helper=',
	'-c',
	'credential.helper=!gh auth git-credential',
] as const;

export const noPromptCredentialEnv: GitCredentialEnv = {
	prepare: () => Promise.resolve({ GIT_TERMINAL_PROMPT: '0', PATH: ghEnvironment().PATH ?? '' }),
};

export function normalizeGithubToken(token: string | null | undefined): string | null {
	const trimmed = token?.trim() ?? '';
	return trimmed.length > 0 ? trimmed : null;
}
