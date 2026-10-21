import { describe, expect, it } from 'vitest';
import { shellCommandPrompt } from './shell-command-prompt';

describe('shellCommandPrompt', () => {
	it('asks the agent to run the command in a fence of its own language', () => {
		expect(shellCommandPrompt('pnpm test', 'bash')).toBe('Run this:\n```bash\npnpm test\n```');
		expect(shellCommandPrompt('ls', null)).toBe('Run this:\n```sh\nls\n```');
	});

	it('fences a command that holds backticks with a longer fence', () => {
		expect(shellCommandPrompt('echo "```"', 'sh')).toBe('Run this:\n````sh\necho "```"\n````');
	});
});
