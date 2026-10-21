export function shellCommandPrompt(command: string, language: string | null): string {
	const longestBacktickRun = Math.max(
		0,
		...[...command.matchAll(/`+/gu)].map(([run]) => run.length),
	);
	const fence = '`'.repeat(Math.max(3, longestBacktickRun + 1));
	return `Run this:\n${fence}${language ?? 'sh'}\n${command}\n${fence}`;
}
