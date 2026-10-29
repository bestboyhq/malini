import { signInToGithubCommand } from '$shared/repositories/application/commands/sign-in-to-github.command';

export { allowGithubWorkflowChangesCommand };

function allowGithubWorkflowChangesCommand(): void {
	signInToGithubCommand('workflow-access');
}
