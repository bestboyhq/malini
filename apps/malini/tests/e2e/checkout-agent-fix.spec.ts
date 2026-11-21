import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
	ISSUE_CREATE_FIXTURE,
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	invoke,
	launchMalini,
	listSessions,
	openWorkstream,
	promptsOf,
	seedWorkstream,
	type LaunchedApp,
} from './harness';

const HEAD_GONE = /ipc-command repositories\.workstream-[a-z-]+ GitError: /u;
const FIX_PROMPT = "Git cannot read this workstream's checkout";

type BrokenCheckout = Readonly<{
	workstreamId: string;
	worktree: string;
	basePath: string;
	said: string;
	restore: () => void;
}>;

function setupSteps(page: Page): Locator {
	return page.getByRole('list', { name: 'Workstream setup' }).getByRole('listitem');
}

async function breakHead(app: LaunchedApp, workstreamId: string): Promise<BrokenCheckout> {
	const { page } = app;
	const source = await createSourceRepo(app.root);
	const { worktree, basePath } = await seedWorkstream(page, source, workstreamId, 'Agent fix');
	await openWorkstream(page, workstreamId);
	const head = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], {
		encoding: 'utf8',
	}).trim();
	const objects = [basePath, source].map((repository) =>
		join(repository, '.git', 'objects', head.slice(0, 2), head.slice(2)),
	);
	for (const object of objects) renameSync(object, `${object}.lost`);
	await page.evaluate(`globalThis.dispatchEvent(new Event('focus'))`);
	const broken = setupSteps(page).filter({ hasText: 'Git cannot read this checkout' });
	await expect(broken).toContainText(/fatal: /u, { timeout: 30_000 });
	const { said } = await invoke<{ said: string | null }>(page, 'repositories.checkout-health', {
		workstreamId,
	});
	if (said === null) throw new Error('git gave no line for a missing HEAD commit');
	await expect(broken).toContainText(said);
	return {
		workstreamId,
		worktree,
		basePath,
		said,
		restore: () => {
			for (const object of objects) renameSync(`${object}.lost`, object);
		},
	};
}

async function fixTurnPrompt(page: Page, workstreamId: string): Promise<string | null> {
	for (const session of await listSessions(page, workstreamId)) {
		for (const prompt of await promptsOf(page, session.id)) {
			const text = prompt['text'];
			if (typeof text === 'string' && text.includes(FIX_PROMPT)) return text;
		}
	}
	return null;
}

test('an agent fixes a checkout git cannot read, and Malini reads it again once the turn ends', async () => {
	test.setTimeout(180_000);
	const app = await launchMalini({ allowedDiagnostics: [HEAD_GONE] });
	try {
		const { page } = app;
		const broken = await breakHead(app, 'e2e-agent-fix-ws');
		await captureFlow(app, 'checkout-agent-fix-broken');

		await setupSteps(page).getByRole('button', { name: 'Ask an agent' }).click();
		const fixing = page.getByRole('status', { name: /An agent is fixing the checkout/u });
		await expect(fixing).toBeVisible();
		await expect.poll(() => fixTurnPrompt(page, broken.workstreamId)).not.toBeNull();
		const prompt = (await fixTurnPrompt(page, broken.workstreamId)) ?? '';
		expect(prompt).toContain(`\`${broken.worktree}\``);
		expect(prompt).toContain(`\`${broken.basePath}\``);
		expect(prompt).toContain('`malini/e2e-agent-fix-ws`');
		expect(prompt).toContain(broken.said);
		expect(prompt).toContain(`git -C "${broken.worktree}" status`);
		await captureFlow(app, 'checkout-agent-fixing');

		broken.restore();
		writeFileSync(join(app.home, 'release-checkout-fix'), '');
		await expect(fixing).toHaveCount(0, { timeout: 30_000 });
		await expect
			.poll(() =>
				invoke(page, 'repositories.checkout-health', { workstreamId: broken.workstreamId }),
			)
			.toMatchObject({ state: 'healthy', said: null });
		await expect(page.getByRole('status', { name: /^Needs you/u })).toHaveCount(0);
		await expect(page.getByText('Git cannot read this checkout')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Ask an agent' })).toHaveCount(0);
		await captureFlow(app, 'checkout-agent-fixed');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});

test('Report files the line git gave about a checkout it cannot read', async () => {
	test.setTimeout(120_000);
	const app = await launchMalini({ allowedDiagnostics: [HEAD_GONE] });
	try {
		const { page } = app;
		const broken = await breakHead(app, 'e2e-agent-report-ws');

		await setupSteps(page).getByRole('button', { name: 'Report' }).click();
		const dialog = page.getByRole('dialog', { name: 'Report a problem' });
		await expect(dialog.getByRole('textbox', { name: 'What broke' })).toHaveValue(
			'Git cannot read a workstream checkout',
		);
		const fact = `Checkout unknown · ${broken.said}`;
		await expect(
			dialog.getByRole('region', { name: 'Goes with it' }).getByRole('switch', { name: fact }),
		).toBeChecked();
		await captureFlow(app, 'checkout-agent-fix-report');
		await dialog.getByRole('button', { name: 'File issue' }).click();
		await expect(dialog).toContainText('Filed as #214');

		const args = readFileSync(join(app.home, ISSUE_CREATE_FIXTURE), 'utf8').split('\0');
		expect(args.slice(4, 6)).toEqual(['--title', 'Git cannot read a workstream checkout']);
		expect(args[7]).toContain(`\n- ${fact}`);
		await dialog.getByRole('button', { name: 'Done' }).click();
		await expect(dialog).toHaveCount(0);
		broken.restore();
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
