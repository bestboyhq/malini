export const ISSUES_REPOSITORY = 'bestboyhq/malini';
export const DISCORD_URL = 'https://bestboy.dev/malini/discord';
export const PROBLEM_TEXT_LIMIT = 10_000;
export const PROBLEM_FACT_LIMIT = 300;
export const PROBLEM_FACTS_MAX = 5;

const TITLE_LIMIT = 80;

export interface Journey {
	readonly repositories: number;
	readonly prompts: number;
	readonly merges: number;
}

export function problemTitle(text: string): string {
	const line =
		text
			.split('\n')
			.map((candidate) => candidate.replace(/\s+/g, ' ').trim())
			.find((candidate) => candidate.length > 0) ?? '';
	return line.length > TITLE_LIMIT ? `${line.slice(0, TITLE_LIMIT - 1).trimEnd()}…` : line;
}

export function problemBody(text: string, facts: readonly string[]): string {
	const said = text.trim();
	if (facts.length === 0) return said;
	return `${said}\n\n---\n\n${facts.map((fact) => `- ${fact}`).join('\n')}`;
}

export function journeyLine(journey: Journey): string {
	return [
		counted(journey.repositories, 'repository', 'repositories'),
		counted(journey.prompts, 'prompt', 'prompts'),
		counted(journey.merges, 'merge', 'merges'),
	].join(' · ');
}

export function failureLine(
	command: string,
	errorName: string | null,
	code: string | null,
): string {
	const failure = errorName === null ? `${command} failed` : `${command} failed: ${errorName}`;
	return code === null ? failure : `${failure} (${code})`;
}

export function issueNumber(url: string): number | null {
	const match = /\/issues\/(\d+)\/?$/.exec(url.trim());
	return match?.[1] === undefined ? null : Number(match[1]);
}

function counted(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}
