import { describe, expect, it } from 'vitest';
import { turnedOffMcpServers, withMcpServerSwitched } from './mcp-servers';

describe('MCP server switches', () => {
	it('turns a server off through deniedMcpServers and back on, keeping every other entry', () => {
		const settings = {
			model: 'opus',
			deniedMcpServers: [{ serverUrl: 'https://*.example.com/*' }, { serverName: 'linear' }],
		};

		const off = withMcpServerSwitched(settings, 'claude.ai Gmail', false);
		expect(off).toEqual({
			model: 'opus',
			deniedMcpServers: [
				{ serverUrl: 'https://*.example.com/*' },
				{ serverName: 'linear' },
				{ serverName: 'claude.ai Gmail' },
			],
		});
		expect(turnedOffMcpServers(off)).toEqual(['linear', 'claude.ai Gmail']);

		const on = withMcpServerSwitched(
			withMcpServerSwitched(off, 'linear', true),
			'claude.ai Gmail',
			true,
		);
		expect(on).toEqual({
			model: 'opus',
			deniedMcpServers: [{ serverUrl: 'https://*.example.com/*' }],
		});
		expect(withMcpServerSwitched({ deniedMcpServers: [{ serverName: 'x' }] }, 'x', true)).toEqual(
			{},
		);
	});
});
