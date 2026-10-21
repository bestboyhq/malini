// ponytail: two commands listed by hand; read Claude Code's supportedCommands() once more belong here.
export const CLAUDE_CODE_COMMANDS = [
	{ name: 'compact', description: 'Free up context by summarizing the conversation so far' },
	{ name: 'autocompact', description: 'Show or set when the conversation compacts on its own' },
] as const;
