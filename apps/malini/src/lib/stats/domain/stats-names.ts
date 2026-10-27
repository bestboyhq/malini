export const SCREENSHOT_TOOL = 'mcp__malini__browser_screenshot';

export const SKILL_TOOL = 'Skill';

const MODEL_FAMILIES = ['opus', 'sonnet', 'haiku', 'fable'] as const;

const BUILT_IN_TOOLS: ReadonlySet<string> = new Set([
	'Agent',
	'AskUserQuestion',
	'Bash',
	'BashOutput',
	'Edit',
	'EnterPlanMode',
	'ExitPlanMode',
	'Glob',
	'Grep',
	'KillShell',
	'LS',
	'ListAgents',
	'MultiEdit',
	'NotebookEdit',
	'NotebookRead',
	'Read',
	'ScheduleWakeup',
	'SendMessage',
	'Skill',
	'SlashCommand',
	'SubagentHandback',
	'Task',
	'TaskStop',
	'TodoWrite',
	'ToolSearch',
	'WebFetch',
	'WebSearch',
	'Workflow',
	'Write',
]);

const MALINI_TOOL_PREFIX = 'mcp__malini__';

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
	ts: 'TypeScript',
	tsx: 'TypeScript',
	mts: 'TypeScript',
	cts: 'TypeScript',
	js: 'JavaScript',
	jsx: 'JavaScript',
	mjs: 'JavaScript',
	cjs: 'JavaScript',
	svelte: 'Svelte',
	vue: 'Vue',
	astro: 'Astro',
	html: 'HTML',
	htm: 'HTML',
	css: 'CSS',
	scss: 'SCSS',
	sass: 'SCSS',
	md: 'Markdown',
	markdown: 'Markdown',
	mdx: 'MDX',
	json: 'JSON',
	jsonc: 'JSON',
	json5: 'JSON',
	yml: 'YAML',
	yaml: 'YAML',
	toml: 'TOML',
	sql: 'SQL',
	graphql: 'GraphQL',
	gql: 'GraphQL',
	py: 'Python',
	pyi: 'Python',
	rb: 'Ruby',
	go: 'Go',
	rs: 'Rust',
	swift: 'Swift',
	m: 'Objective-C',
	mm: 'Objective-C',
	kt: 'Kotlin',
	kts: 'Kotlin',
	java: 'Java',
	scala: 'Scala',
	sc: 'Scala',
	c: 'C',
	h: 'C',
	cc: 'C++',
	cpp: 'C++',
	cxx: 'C++',
	hh: 'C++',
	hpp: 'C++',
	hxx: 'C++',
	cs: 'C#',
	php: 'PHP',
	sh: 'Shell',
	bash: 'Shell',
	zsh: 'Shell',
	fish: 'Shell',
	dart: 'Dart',
	ex: 'Elixir',
	exs: 'Elixir',
	erl: 'Erlang',
	hrl: 'Erlang',
	hs: 'Haskell',
	lua: 'Lua',
	zig: 'Zig',
	nix: 'Nix',
	dockerfile: 'Dockerfile',
	tf: 'Terraform',
	tfvars: 'Terraform',
	gd: 'GDScript',
};

export function modelFamily(model: string | null): string {
	const name = model?.toLowerCase() ?? '';
	return MODEL_FAMILIES.find((family) => name.includes(family)) ?? 'other';
}

export function toolGroup(tool: string): string {
	if (BUILT_IN_TOOLS.has(tool)) return tool;
	if (tool.startsWith(`${MALINI_TOOL_PREFIX}browser_`)) return 'Browser';
	if (tool.startsWith('mcp__')) return 'MCP';
	return 'other';
}

export function mcpServerGroup(tool: string): string | null {
	if (!tool.startsWith('mcp__')) return null;
	return tool.startsWith(MALINI_TOOL_PREFIX) ? 'malini' : 'other';
}

export function languageOf(path: string): string {
	const file = path.slice(path.lastIndexOf('/') + 1);
	if (/^dockerfile(?:\..+)?$/iu.test(file)) return 'Dockerfile';
	const dot = file.lastIndexOf('.');
	if (dot <= 0) return 'Other';
	return LANGUAGE_BY_EXTENSION[file.slice(dot + 1).toLowerCase()] ?? 'Other';
}
