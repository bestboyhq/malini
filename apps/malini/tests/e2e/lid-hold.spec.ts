import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
	captureFlow,
	createSourceRepo,
	expectCleanConsole,
	fileExists,
	invoke,
	launchMalini,
	openSettingsFromMenu,
	openWorkstream,
	seedWorkstream,
	sendPrompt,
	temporaryRoot,
	withoutConsoleErrors,
	writeExecutable,
} from './harness';

const MAC_ONLY = 'Close My Lid drives pmset and launchd, which only macOS has';
const LINUX_ONLY = 'systemd-logind holds the lid switch only on Linux';

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
		writeExecutable(join(tools, name), script);
	}
	return tools;
}

const SYSTEMD_INHIBIT = `#!/bin/sh
tools="$(dirname "$0")"
if [ "$1" = --list ]; then
	[ -f "$tools/no-logind" ] && { echo 'Failed to list inhibitors: Could not activate remote peer.' >&2; exit 1; }
	exit 0
fi
echo "$1" >> "$tools/inhibits"
[ -f "$tools/denied" ] && { echo 'Failed to inhibit: Access denied' >&2; exit 1; }
shift 4
echo 1 > "$tools/held"
"$@"
echo 0 > "$tools/held"
`;

function fakeInhibitor(root: string): string {
	const tools = join(root, 'lid-tools');
	mkdirSync(tools);
	writeExecutable(join(tools, 'systemd-inhibit'), SYSTEMD_INHIBIT);
	return tools;
}

function held(tools: string): string {
	return fileExists(join(tools, 'held')) ? readFileSync(join(tools, 'held'), 'utf8').trim() : '';
}

function inhibits(tools: string): string[] {
	if (!fileExists(join(tools, 'inhibits'))) return [];
	return readFileSync(join(tools, 'inhibits'), 'utf8').split('\n').filter(Boolean);
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
	await openSettingsFromMenu(page);
	await page
		.getByRole('navigation', { name: 'Settings' })
		.getByRole('link', { name: 'Power' })
		.click();
	return page.getByRole('dialog', { name: 'Settings' });
}

test('with the lid switch on, the Mac stays awake while an agent works and sleeps once it stops', async () => {
	test.skip(process.platform !== 'darwin', MAC_ONLY);
	test.setTimeout(120_000);
	const root = temporaryRoot('malini-lid-');
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
	test.skip(process.platform !== 'darwin', MAC_ONLY);
	test.setTimeout(180_000);
	const root = temporaryRoot('malini-lid-');
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

test('with the lid switch on, logind holds the lid while an agent works and lets go once it stops', async () => {
	test.skip(process.platform !== 'linux', LINUX_ONLY);
	test.setTimeout(120_000);
	const root = temporaryRoot('malini-lid-');
	const tools = fakeInhibitor(root);
	writeFileSync(join(tools, 'denied'), '');
	const app = await launchMalini({
		env: { MALINI_LID_TOOLS: tools },
		allowedDiagnostics: [/Failed to inhibit: Access denied/u],
	});
	try {
		const { page } = app;
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-lid-ws', 'Lid workstream');
		const settings = await openPowerSettings(page);
		const lid = settings.getByRole('switch', { name: 'Keep working with the lid closed' });
		await expect(lid).not.toBeChecked();

		await lid.click();
		await expect(settings.getByRole('alert')).toHaveText(
			"Linux didn't allow it. Malini needs a local desktop session to hold the lid.",
		);
		await expect(lid).not.toBeChecked();
		await expect(lid).toBeEnabled();
		const denied = /could not save the lid setting/u;
		await expect.poll(() => app.consoleErrors.some((line) => denied.test(line))).toBe(true);
		withoutConsoleErrors(app, denied);

		rmSync(join(tools, 'denied'));
		await lid.click();
		await expect(lid).toBeChecked();
		await expect(settings.getByRole('alert')).toBeHidden();
		expect(inhibits(tools)).toEqual(['--what=handle-lid-switch', '--what=handle-lid-switch']);
		expect(held(tools)).toBe('0');
		await captureFlow(app, 'lid-hold-settings-linux');
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
		await expect.poll(() => held(tools)).toBe('1');

		await submit.click();
		await expect(submit).toHaveAccessibleName('Send prompt');
		await expect.poll(() => held(tools)).toBe('0');

		await sendPrompt(page, 'HANG');
		await expect.poll(() => held(tools)).toBe('1');
		expect(await invoke<boolean>(page, 'app.hold-lid', { on: false })).toBe(false);
		await expect.poll(() => held(tools)).toBe('0');
		expect(await invoke<boolean>(page, 'app.hold-lid', { on: true })).toBe(true);
		await expect.poll(() => held(tools)).toBe('1');

		expectCleanConsole(app);
		await app.quit();
		expect(held(tools)).toBe('0');
	} finally {
		await app.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test('once the Malini that holds the lid is gone, logind lets the computer sleep again', async () => {
	test.skip(process.platform !== 'linux', LINUX_ONLY);
	test.setTimeout(120_000);
	const root = temporaryRoot('malini-lid-');
	const tools = fakeInhibitor(root);
	const app = await launchMalini({ env: { MALINI_LID_TOOLS: tools } });
	try {
		const { page } = app;
		expect(await invoke<boolean>(page, 'app.hold-lid', { on: true })).toBe(true);
		const source = await createSourceRepo(app.root);
		const { workstreamId } = await seedWorkstream(page, source, 'e2e-lid-crash-ws', 'Lid crash');
		await openWorkstream(page, workstreamId);
		await sendPrompt(page, 'HANG');
		await expect.poll(() => held(tools)).toBe('1');
		expectCleanConsole(app);

		app.electronApp.process().kill('SIGKILL');
		await expect.poll(() => held(tools)).toBe('0');
	} finally {
		await app.close().catch(() => undefined);
		rmSync(root, { recursive: true, force: true });
	}
});

test('without systemd-logind, the lid switch says so and stays off', async () => {
	test.skip(process.platform !== 'linux', LINUX_ONLY);
	const root = temporaryRoot('malini-lid-');
	const tools = fakeInhibitor(root);
	writeFileSync(join(tools, 'no-logind'), '');
	const app = await launchMalini({ env: { MALINI_LID_TOOLS: tools } });
	try {
		const source = await createSourceRepo(app.root);
		await seedWorkstream(app.page, source, 'e2e-lid-off-ws', 'Lid off');
		const settings = await openPowerSettings(app.page);
		await expect(
			settings.getByText('No systemd-logind here, so the lid does what it always does.'),
		).toBeVisible();
		await expect(
			settings.getByRole('switch', { name: 'Keep working with the lid closed' }),
		).toBeDisabled();
		expect(inhibits(tools)).toEqual([]);
		expectCleanConsole(app);
	} finally {
		await app.close();
		rmSync(root, { recursive: true, force: true });
	}
});
