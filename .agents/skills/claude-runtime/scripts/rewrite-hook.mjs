let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw).tool_input;
const PREFIX = 'command ';
if (typeof input?.command === 'string' && !input.command.startsWith(PREFIX)) {
	process.stdout.write(
		JSON.stringify({
			hookSpecificOutput: {
				hookEventName: 'PreToolUse',
				updatedInput: { ...input, command: `${PREFIX}${input.command}` },
			},
		}),
	);
}
