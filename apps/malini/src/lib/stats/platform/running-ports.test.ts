import { describe, expect, it } from 'vitest';
import { listeningPort, parseLsofNames, readPortsByFile, type PortTool } from './running-ports';

const OUTPUT = '/private/tmp/claude-501/ws/tasks/bq9x3ovqm.output';
const OTHER_OUTPUT = '/private/tmp/claude-501/ws/tasks/b7k2v1x0p.output';

const HOLDERS = [
	'p55433',
	'f1',
	`n${OUTPUT}`,
	'f2',
	`n${OUTPUT}`,
	'p55772',
	'f1',
	`n${OUTPUT}`,
	'p61000',
	'f1',
	`n${OTHER_OUTPUT}`,
	'',
].join('\n');

const PROCESS_TABLE = [
	'17950     1  2048   0.0 /bin/zsh',
	'55433 17950  9216   0.0 npm exec wrangler@4 dev --port 8791',
	'55772 55433 81920   1.2 /Users/me/.nvm/versions/node/v24.18.0/bin/node',
	'55853 55772 40960   0.4 /Users/me/.npm/_npx/c9/node_modules/@cloudflare/workerd/bin/workerd',
	'61000 17950  4096   0.0 node',
	'',
].join('\n');

const LISTENING = [
	'p668',
	'f10',
	'n*:62939',
	'p55853',
	'f15',
	'n[::1]:8791',
	'f16',
	'n127.0.0.1:8791',
	'f17',
	'n127.0.0.1:9229',
	'p55772',
	'f20',
	'n*:5173',
	'f21',
	'n127.0.0.1:50075',
	'',
].join('\n');

describe('running ports', () => {
	it('reads the pids that hold each file from lsof field output', () => {
		expect(parseLsofNames(HOLDERS)).toEqual(
			new Map([
				[55433, [OUTPUT, OUTPUT]],
				[55772, [OUTPUT]],
				[61000, [OTHER_OUTPUT]],
			]),
		);
	});

	it('reads the port of every listening socket name', () => {
		expect(listeningPort('127.0.0.1:8791')).toBe(8791);
		expect(listeningPort('[::1]:8791')).toBe(8791);
		expect(listeningPort('*:5173')).toBe(5173);
		expect(listeningPort('*:99999')).toBeNull();
		expect(listeningPort('/var/run/docker.sock')).toBeNull();
	});

	it("finds the fixed ports a command's whole process tree listens on", async () => {
		const calls: string[] = [];
		const read = async (tool: PortTool, args: readonly string[]): Promise<string> => {
			calls.push(`${tool} ${args.join(' ')}`);
			if (tool === 'ps') return PROCESS_TABLE;
			return args.includes('-iTCP') ? LISTENING : HOLDERS;
		};

		const ports = await readPortsByFile(read, [OUTPUT, OTHER_OUTPUT]);

		expect(ports).toEqual(
			new Map([
				[OUTPUT, [5173, 8791, 9229]],
				[OTHER_OUTPUT, []],
			]),
		);
		expect(calls).toContain(`lsof -F pn -- ${OUTPUT} ${OTHER_OUTPUT}`);
		expect(await readPortsByFile(read, [])).toEqual(new Map());
	});
});
