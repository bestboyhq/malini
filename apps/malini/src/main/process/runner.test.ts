import { describe, expect, it } from 'vitest';
import { createNodeProcessRunner, runBounded } from './runner';

const GRANDCHILD =
	"require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30_000)'], { stdio: 'inherit' })";

describe('the node process runner', () => {
	const runner = createNodeProcessRunner();

	it('reports exit codes and both streams', async () => {
		const run = await runBounded(
			runner,
			process.execPath,
			['-e', "console.log('out'); console.error('err'); process.exitCode = 3"],
			{ deadline: Date.now() + 5_000 },
		);
		expect(run).toMatchObject({ exitCode: 3, stdout: 'out\n', stderr: 'err\n' });
	});

	it('kills a child that outlives the deadline, whole group included', async () => {
		const started = Date.now();
		const run = await runBounded(runner, process.execPath, ['-e', GRANDCHILD], {
			deadline: started + 200,
		});
		expect(run.exitCode).toBeNull();
		expect(Date.now() - started).toBeLessThan(5_000);
	});

	it('reports a missing binary through exit, not a throw', async () => {
		const handle = runner.spawn('/nonexistent/malini-no-such-binary', []);
		expect(handle.pid).toBeNull();
		expect(await handle.exit).toMatchObject({ kind: 'failed' });
		await expect(
			runBounded(runner, '/nonexistent/malini-no-such-binary', [], { deadline: Date.now() + 1000 }),
		).rejects.toThrow(/could not run/);
	});

	it('settles once the child exits even when a background child keeps its pipes open', async () => {
		const started = Date.now();
		const run = await runBounded(
			runner,
			process.execPath,
			['-e', `${GRANDCHILD}.unref(); console.log('out')`],
			{ deadline: started + 10_000 },
		);
		expect(run).toMatchObject({ exitCode: 0, stdout: 'out\n' });
		expect(Date.now() - started).toBeLessThan(5_000);
	});
});
