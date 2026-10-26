import { execFileSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
	createSourceRepo,
	currentSessionId,
	launchMalini,
	listEvents,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

function runs(root: string): string {
	return execFileSync('sqlite3', [
		join(root, 'user-data', 'malini.sqlite'),
		'SELECT id, prompt, completed_at IS NOT NULL, error FROM agent_runs ORDER BY rowid',
	]).toString();
}

const SLOW_GIT = `#!/bin/sh
if [ -f "$HOME/slow-checkpoint" ]; then
  case "$*" in *refs/malini/checkpoints/*) sleep 2 ;; esac
fi
exec /opt/homebrew/bin/git "$@"
`;

for (const slow of [false, true]) {
	test(`repro: quit right after Send, slow checkpoint ${slow}`, async () => {
		test.setTimeout(240_000);
		const first = await launchMalini();
		let sessionId: string | null = null;
		try {
			const { page } = first;
			const shim = join(first.bin, 'git');
			writeFileSync(shim, SLOW_GIT);
			chmodSync(shim, 0o755);
			const source = await createSourceRepo(first.root, 'acme/resume');
			await seedWorkstream(page, `file://${source}`, 'e2e-resume-ws', 'Resume work');
			await openWorkstream(page, 'e2e-resume-ws');
			if (slow) writeFileSync(join(first.home, 'slow-checkpoint'), '');
			await sendPrompt(page, 'HANG until Malini restarts');
			await expect(page.getByTestId('chat-composer-submit')).toHaveAccessibleName(
				'Stop current run',
				{ timeout: 20_000 },
			);
			sessionId = currentSessionId(page);
			await page.waitForTimeout(300);
			await first.quit();
		} catch (error) {
			await first.close();
			throw error;
		}
		console.log(`--- after quit (slow ${slow}):\n${runs(first.root)}`);

		const app = await launchMalini({ profile: first.root });
		try {
			const { page } = app;
			await openWorkstream(page, 'e2e-resume-ws');
			await page.waitForTimeout(8_000);
			console.log(`--- after restart (slow ${slow}):\n${runs(first.root)}`);
			const events = await listEvents(page, sessionId ?? currentSessionId(page) ?? '');
			console.log(
				events
					.map(
						({ runId, event }) =>
							`${runId} ${event.type} ${JSON.stringify(event).slice(0, 160)}`,
					)
					.join('\n'),
			);
		} finally {
			await app.close();
		}
	});
}
