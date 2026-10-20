import { describe, expect, it } from 'vitest';
import { toolImageRead } from './tool-image-read';

describe('toolImageRead', () => {
	it('recognizes the text the Claude bridge reports for an image Read', () => {
		const input = { file_path: '/Users/simon/malini/workstreams/ws-1/docs/shot.PNG' };

		expect(toolImageRead('Read', input, '[image]', 'ws-1')).toEqual({
			path: 'docs/shot.PNG',
			fileName: 'shot.PNG',
			mediaType: 'image/png',
		});
		expect(toolImageRead('Read', { file_path: 'notes.txt' }, '[image]', 'ws-1')).toBeNull();
		expect(toolImageRead('Read', input, 'plain text', 'ws-1')).toBeNull();
	});

	it('addresses an image outside this worktree by the absolute path the agent read', () => {
		for (const path of [
			'/tmp/refscripts/hero.png',
			'/Users/simon/malini/workstreams/ws-2/docs/shot.png',
			'/Users/simon/malini/repositories/app/base/.claude/worktrees/agent-a1/shot.png',
		]) {
			expect(toolImageRead('Read', { file_path: path }, '[image]', 'ws-1')).toMatchObject({
				path,
				fileName: path.split('/').pop(),
			});
		}
	});

	it("keeps a background agent's worktree inside this one addressable from this worktree", () => {
		const input = {
			file_path: '/Users/simon/malini/workstreams/ws-1/.claude/worktrees/agent-a1/shot.png',
		};

		expect(toolImageRead('Read', input, '[image]', 'ws-1')?.path).toBe(
			'.claude/worktrees/agent-a1/shot.png',
		);
	});

	it('declines an image output from a tool that is not a read', () => {
		expect(toolImageRead('Write', { file_path: 'shot.png' }, '[image]', 'ws-1')).toBeNull();
		expect(toolImageRead('Bash', { command: 'cat shot.png' }, '[image]', 'ws-1')).toBeNull();
	});

	it('declines an image with no path to address', () => {
		expect(toolImageRead('Read', {}, '[image]', 'ws-1')).toBeNull();
		expect(toolImageRead('Read', { file_path: 'shot.png' }, undefined, 'ws-1')).toBeNull();
	});
});
