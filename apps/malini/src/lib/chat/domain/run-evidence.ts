const TRAILING_COMMIT_LINE =
	/^[\s\S]*(?:^|\s)Commit:\s*(.+?)(?:\s+(?:Pull request|Resolved):.*)?\s*$/u;
const TRAILING_PULL_REQUEST_LINE =
	/^[\s\S]*(?:^|\s)Pull request:\s*(.+?)(?:\s+(?:Commit|Resolved):.*)?\s*$/u;

export function commitLine(summary: string): string {
	return TRAILING_COMMIT_LINE.exec(summary)?.[1] ?? '';
}

const COMMAND_SEPARATOR = /\s*(?:&&|\|\||[;|\n])\s*/u;
const REDIRECTION = /\s+\d?>&\d|\s+\d?>{1,2}\s*\S+/gu;
const ENVIRONMENT_PREFIX = /^(?:\w+=\S*\s+)+/u;
const VALIDATION_PROGRAM =
	/^(?:(?:corepack\s+)?(?:pnpm|npm|yarn|bun)(?:\s+(?:--filter|-F|-C|--dir|-w|-r|--recursive)(?:[\s=][^\s-]\S*)?)*\s+(?:run\s+)?(?:exec\s+)?(?:test|check|lint|typecheck|build|e2e|vitest|playwright|tsc|eslint|svelte-check)(?::\S+)?|(?:npx\s+)?(?:vitest|jest|playwright|tsc|svelte-check|eslint|pytest|mypy|ruff)|node\s+--test|cargo\s+(?:test|clippy|fmt|check|build)|go\s+(?:test|vet|build)|make\s+(?:test|check|lint))(?:\s|$)/u;

export function validationLabel(command: string): string {
	const script = command.includes('<<') ? (command.split('\n')[0] ?? '') : command;
	return script
		.split(COMMAND_SEPARATOR)
		.map((part) =>
			part
				.replace(/^[(\s]+|[)\s]+$/gu, '')
				.replace(REDIRECTION, '')
				.replace(ENVIRONMENT_PREFIX, ''),
		)
		.filter((part) => VALIDATION_PROGRAM.test(part))
		.join('; ');
}

export function takeLastUnique(values: readonly string[], limit: number): readonly string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (let index = values.length - 1; index >= 0 && result.length < limit; index -= 1) {
		const value = values[index];
		if (!value || seen.has(value)) continue;
		seen.add(value);
		result.push(value);
	}
	return result.reverse();
}

export function pullRequestTitleLine(summary: string): string {
	return TRAILING_PULL_REQUEST_LINE.exec(summary)?.[1] ?? '';
}
