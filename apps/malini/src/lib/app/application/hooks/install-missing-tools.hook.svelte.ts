import {
	claudeCodeInstallQuery,
	claudeCodeStatusQuery,
	installClaudeCodeCommand,
	loadProviderCapabilitiesCommand,
} from '$shared/providers/providers.api';
import {
	githubAuthErrorQuery,
	githubAuthQuery,
	githubCliInstallQuery,
	githubSetupStatus,
	installGithubCliCommand,
	loadGithubAuthCommand,
} from '$shared/repositories/repositories.api';

export function installMissingToolsHook(): () => void {
	let claudeCodeTried = false;
	let githubCliTried = false;
	loadProviderCapabilitiesCommand();
	loadGithubAuthCommand();
	return $effect.root(() => {
		$effect(() => {
			if (claudeCodeTried || claudeCodeStatusQuery.data.kind !== 'missing') return;
			if (claudeCodeInstallQuery.data.kind !== 'idle') return;
			claudeCodeTried = true;
			installClaudeCodeCommand();
		});
		$effect(() => {
			if (githubCliTried) return;
			if (githubSetupStatus(githubAuthQuery.data, githubAuthErrorQuery.data) !== 'missing') return;
			if (githubCliInstallQuery.data.kind !== 'idle') return;
			githubCliTried = true;
			installGithubCliCommand();
		});
	});
}
