import { execFileSync } from 'node:child_process';
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	fileExists,
	invoke,
	launchMalini,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
} from './harness';

const SUDO = `#!/bin/sh
tools="$(dirname "$0")"
echo "sudo $*" >> "$tools/calls"
[ "$1" = -n ] && [ -f "$tools/granted" ] || { echo 'sudo: a password is required' >&2; exit 1; }
[ "$2 $3 $4" = '/usr/bin/pmset -a disablesleep' ] || exit 1
printf '%s' "$5" > "$tools/sleep-disabled"
`;

const PMSET = `#!/bin/sh
tools="$(dirname "$0")"
if [ "$2" = batt ]; then echo "Now drawing from 'AC Power'"; exit 0; fi
echo 'System-wide power settings:'
[ "$(cat "$tools/sleep-disabled" 2>/dev/null)" = 1 ] && printf ' SleepDisabled\\t\\t1\\n'
echo ' sleep 1'
`;

const OSASCRIPT = `#!/bin/sh
tools="$(dirname "$0")"
echo osascript >> "$tools/calls"
[ -f "$tools/cancel" ] && { echo '0:1: execution error: User canceled. (-128)' >&2; exit 1; }
case "$2" in *'NOPASSWD: /usr/bin/pmset -a disablesleep 1, /usr/bin/pmset -a disablesleep 0'*) touch "$tools/granted" ;; *) exit 1 ;; esac
`;

const LAUNCHCTL = `#!/bin/sh
tools="$(dirname "$0")"
echo "launchctl $1" >> "$tools/calls"
case "$1" in
print) [ -f "$tools/loaded" ] ;;
bootstrap) plutil -lint -s "$3" && touch "$tools/loaded" ;;
bootout) rm -f "$tools/loaded" ;;
esac
`;

function fakeLidTools(root: string): string {
	const tools = join(root, 'lid-tools');
	mkdirSync(tools);
	for (const [name, script] of [
		['sudo', SUDO],
		['pmset', PMSET],
		['osascript', OSASCRIPT],
		['launchctl', LAUNCHCTL],
	] as const) {
		writeFileSync(join(tools, name), script);
		chmodSync(join(tools, name), 0o755);
	}
	return tools;
}

function sleepDisabled(tools: string): string {
	return fileExists(join(tools, 'sleep-disabled'))
		? readFileSync(join(tools, 'sleep-disabled'), 'utf8')
		: '';
}

function adminPrompts(tools: string): number {
	if (!fileExists(join(tools, 'calls'))) return 0;
	return readFileSync(join(tools, 'calls'), 'utf8')
		.split('\n')
		.filter((line) => line === 'osascript').length;
}

function launchAgents(tools: string): string[] {
	return fileExists(join(tools, 'LaunchAgents')) ? readdirSync(join(tools, 'LaunchAgents')) : [];
}

function runLaunchAgent(tools: string): void {
	const [plist = ''] = launchAgents(tools);
	const agent = JSON.parse(
		execFileSync(
			'/usr/bin/plutil',
			['-convert', 'json', '-o', '-', join(tools, 'LaunchAgents', plist)],
			{ encoding: 'utf8' },
		),
	) as { ProgramArguments: string[] };
	const [program = '', ...args] = agent.ProgramArguments;
	execFileSync(program, args);
}

async function openPowerSettings(page: Page) {
	await page.getByTestId('global-topbar-open-settings').click();
	await page
		.getByRole('navigation', { name: 'Settings' })
		.getByRole('link', { name: 'Power' })
		.click();
	return page.getByRole('dialog', { name: 'Settings' });
}

test('with the lid switch on, the Mac stays awake while an agent works and sleeps once it stops', async () => {
	test.setTimeout(120_000);
	const root = mkdtempSync(join(tmpdir(), 'malini-lid-'));
	const tools = fakeLidTools(root);
	writeFileSync(join(tools, 'cancel'), '');
	const app = await launchMalini({ env: { MALINI_LID_TOOLS: tools } });
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-lid-ws', 'Lid workstream');
		const settings = await openPowerSettings(page);
		const lid = settings.getByRole('switch', { name: 'Keep working with the lid closed' });
		await expect(lid).not.toBeChecked();
		await expect(settings.getByRole('link', { name: 'Krish Kalaria' })).toHaveAttribute(
			'href',
			'https://github.com/krishkalaria12',
		);
		await expect(settings.getByRole('link', { name: 'Close My Lid' })).toHaveAttribute(
			'href',
			'https://github.com/krishkalaria12/close-my-lid',
		);

		await lid.click();
		await expect.poll(() => adminPrompts(tools)).toBe(1);
		await expect(lid).not.toBeChecked();
		await expect(lid).toBeEnabled();
		await expect(settings.getByRole('alert')).toBeHidden();

		rmSync(join(tools, 'cancel'));
		await lid.click();
		await expect(lid).toBeChecked();
		await expect(lid).toBeEnabled();
		expect(adminPrompts(tools)).toBe(2);
		expect(sleepDisabled(tools)).toBe('0');
		expect(launchAgents(tools)).toHaveLength(1);
		expect(fileExists(join(tools, 'loaded'))).toBe(true);
		await captureFlow(app, 'lid-hold-settings');
		const closed = page.evaluate(
			"new Promise((resolve) => addEventListener('popstate', resolve, { once: true }))",
		);
		await page.keyboard.press('Escape');
		await closed;
		await expect(settings).toBeHidden();

		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'HANG');
		const submit = page.getByTestId('chat-composer-submit');
		await expect(submit).toHaveAccessibleName('Stop current run', { timeout: 20_000 });
		await expect.poll(() => sleepDisabled(tools)).toBe('1');

		await submit.click();
		await expect(submit).toHaveAccessibleName('Send prompt');
		await expect.poll(() => sleepDisabled(tools)).toBe('0');

		await sendPrompt(page, 'HANG');
		await expect.poll(() => sleepDisabled(tools)).toBe('1');
		expect(await invoke<boolean>(page, 'app.hold-lid', { on: false })).toBe(false);
		await expect.poll(() => sleepDisabled(tools)).toBe('0');
		expect(launchAgents(tools)).toEqual([]);
		expect(fileExists(join(tools, 'loaded'))).toBe(false);
		expect(await invoke<boolean>(page, 'app.hold-lid', { on: true })).toBe(true);
		expect(adminPrompts(tools)).toBe(2);
		await expect.poll(() => sleepDisabled(tools)).toBe('1');
		expect(launchAgents(tools)).toHaveLength(1);

		expectCleanConsole(app);
		await app.quit();
		expect(sleepDisabled(tools)).toBe('0');
		expect(launchAgents(tools)).toHaveLength(1);
	} finally {
		await app.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test('once the Malini that holds the lid is gone, launchd or its next launch lets the Mac sleep again', async () => {
	test.setTimeout(180_000);
	const root = mkdtempSync(join(tmpdir(), 'malini-lid-'));
	const tools = fakeLidTools(root);
	writeFileSync(join(tools, 'granted'), '');
	const env = { MALINI_LID_TOOLS: tools };
	const app = await launchMalini({ env });
	try {
		const { page } = app;
		expect(await invoke<boolean>(page, 'app.hold-lid', { on: true })).toBe(true);
		expect(adminPrompts(tools)).toBe(0);
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-lid-crash-ws', 'Lid crash');
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'HANG');
		await expect.poll(() => sleepDisabled(tools)).toBe('1');

		app.electronApp.process().kill('SIGKILL');
		await app.quit().catch(() => undefined);
		expect(sleepDisabled(tools)).toBe('1');

		const relaunched = await launchMalini({ profile: app.root, env });
		try {
			await expect.poll(() => sleepDisabled(tools), { timeout: 20_000 }).toBe('0');
			expect(await invoke<boolean>(relaunched.page, 'app.hold-lid', { on: true })).toBe(true);
			expect(sleepDisabled(tools)).toBe('0');
			await openWorkstream(relaunched.page, workstreamId);
			await sendPrompt(relaunched.page, 'HANG');
			await expect.poll(() => sleepDisabled(tools)).toBe('1');
			runLaunchAgent(tools);
			expect(sleepDisabled(tools)).toBe('1');
			expectCleanConsole(relaunched);

			relaunched.electronApp.process().kill('SIGKILL');
			await expect
				.poll(() => {
					runLaunchAgent(tools);
					return sleepDisabled(tools);
				})
				.toBe('0');
			writeFileSync(join(tools, 'sleep-disabled'), '1');
			runLaunchAgent(tools);
			expect(sleepDisabled(tools)).toBe('1');
		} finally {
			await relaunched.quit().catch(() => undefined);
		}
	} finally {
		await app.close().catch(() => undefined);
		rmSync(root, { recursive: true, force: true });
	}
});
