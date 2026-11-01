import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { SavedSecret } from '../../src/contract/secrets';
import {
	captureFlow,
	createSourceRepo,
	currentSessionId,
	expectCleanConsole,
	invoke,
	launchMalini,
	listEvents,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	type LaunchedApp,
} from './harness';

const STRIPE = 'sk-live-e2e-4f9a1c2b7d';
const REPLACED = 'sk-live-e2e-replaced-8e3d';

function secretsSeenByTheBridge(app: LaunchedApp): string {
	try {
		return readFileSync(join(app.home, 'malini-secrets.jsonl'), 'utf8');
	} catch {
		return '';
	}
}

function filesHolding(folder: string, text: string): string[] {
	return readdirSync(folder, { recursive: true, encoding: 'utf8' }).filter((entry) => {
		const path = join(folder, entry);
		try {
			return lstatSync(path).isFile() && readFileSync(path).includes(text);
		} catch (error) {
			if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
			throw error;
		}
	});
}

async function pasteInto(page: Page, selector: string, text: string): Promise<void> {
	await page.evaluate(`(() => {
		const data = new DataTransfer();
		data.setData('text/plain', ${JSON.stringify(text)});
		document
			.querySelector(${JSON.stringify(selector)})
			.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
	})()`);
}

async function openSecretsSettings(page: Page): Promise<void> {
	await page.evaluate(() => {
		location.hash = '#/settings/secrets';
	});
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Secrets', level: 2 })).toBeVisible({
		timeout: 20_000,
	});
}

test('an agent asks for secrets on a card in the chat, the user saves one, and only its name reaches the agent and the transcript', async () => {
	test.setTimeout(240_000);
	const app = await launchMalini();
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const seeded = await seedWorkstream(page, source, 'e2e-secrets-ws', 'Secrets workstream');
		await openWorkstream(page, seeded.workstreamId);
		writeFileSync(
			join(app.home, 'malini-tool.json'),
			JSON.stringify({
				tool: 'secrets_request',
				input: {
					names: ['STRIPE_KEY', 'SENDGRID_KEY'],
					why: 'To create test customers in your Stripe sandbox.',
				},
			}),
		);

		await sendPrompt(page, 'MALINI_TOOL');
		const card = page.getByRole('region', {
			name: 'To create test customers in your Stripe sandbox.',
		});
		await expect(card).toBeVisible({ timeout: 20_000 });
		const save = card.getByRole('button', { name: 'Save', exact: true });
		await expect(save).toBeDisabled();
		await expect(card.getByLabel('Value for STRIPE_KEY')).toBeFocused();
		await pasteInto(
			page,
			'[data-testid="chat-composer-input"]',
			`# shop\nexport STRIPE_KEY="${STRIPE}"\nGITHUB_TOKEN=ghp-not-asked\n`,
		);
		await expect(card.getByLabel('Value for STRIPE_KEY')).toHaveValue(STRIPE);
		await expect(card.getByLabel('Value for SENDGRID_KEY')).toHaveValue('');
		await expect(page.getByTestId('chat-composer-input')).not.toContainText('STRIPE_KEY');
		await expect(card.getByLabel('Value for STRIPE_KEY')).toHaveAttribute('type', 'password');
		await page.mouse.move(0, 0);
		await captureFlow(app, 'secrets-1-card');
		await save.click();
		await expect(card).toBeHidden({ timeout: 20_000 });

		const sessionId = currentSessionId(page);
		if (!sessionId) throw new Error('the chat has no session id');
		const delivered = async (): Promise<string> =>
			(await listEvents(page, sessionId))
				.filter(({ event }) => event.type === 'user.message')
				.map(({ event }) => String(event['text'] ?? ''))
				.find((text) => text.startsWith('Saved ')) ?? '';
		await expect.poll(delivered, { timeout: 20_000 }).toContain('Saved STRIPE_KEY for ');
		expect(await delivered()).toContain('SENDGRID_KEY was left empty, so it is still not set.');
		await expect.poll(() => secretsSeenByTheBridge(app), { timeout: 20_000 }).toContain(STRIPE);
		expect(JSON.stringify(await listEvents(page, sessionId))).not.toContain(STRIPE);
		expect(filesHolding(app.userDataDir, STRIPE)).toEqual([]);
		await page.mouse.move(0, 0);
		await captureFlow(app, 'secrets-2-agent-told');

		await openSecretsSettings(page);
		const settings = page.getByRole('dialog', { name: 'Settings' });
		const row = settings.getByRole('listitem').filter({ hasText: 'STRIPE_KEY' });
		await expect(row).toBeVisible();
		await page.mouse.move(0, 0);
		await captureFlow(app, 'secrets-3-settings');
		await row.getByRole('button', { name: 'Replace STRIPE_KEY' }).click();
		await row.getByLabel('New value for STRIPE_KEY').fill(REPLACED);
		await row.getByRole('button', { name: 'Save' }).click();
		await expect
			.poll(async () => (await invoke<SavedSecret[]>(page, 'secrets.list', undefined)).length)
			.toBe(1);
		await expect(settings.getByLabel('New value for STRIPE_KEY')).toBeHidden({ timeout: 20_000 });
		expect(JSON.stringify(await invoke(page, 'secrets.list', undefined))).not.toContain(REPLACED);

		await settings.getByRole('button', { name: 'Delete STRIPE_KEY' }).click();
		await expect(settings.getByText('Nothing yet. When an agent asks for a secret')).toBeVisible({
			timeout: 20_000,
		});
		expect(await invoke(page, 'secrets.list', undefined)).toEqual([]);
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
