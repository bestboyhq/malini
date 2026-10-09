import { execFile } from 'node:child_process';
import {
	accessSync,
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
	_electron as electron,
	expect,
	type ElectronApplication,
	type Page,
} from '@playwright/test';
import type { DiagnosticEntry } from '../../src/contract/diagnostics';
import {
	BRIDGE_CONTRACT_NAME,
	BRIDGE_HEARTBEAT_INTERVAL_MS,
	BRIDGE_PROTOCOL_VERSION,
} from '../../src/contract/protocol-contract.generated';
import { diagnosticsLogFiles, readDiagnostics } from '../../src/main/diagnostics/diagnostics-files';

const execFileAsync = promisify(execFile);

export interface RuntimeInfo {
	app: string;
	electron: string;
	node: string;
	chrome: string;
	sqlite: string;
	dataDirectory: string;
}

interface MaliniBridge {
	invoke(name: string, input: unknown): Promise<unknown>;
}

declare global {
	var malini: MaliniBridge;
	var location: { hash: string };
}

export const APP_ROOT = resolve(__dirname, '../..');
export const E2E_ROOT = resolve(APP_ROOT, 'tests/e2e');
export const CONTEXT_ROOT = resolve(APP_ROOT, '../..', '.context');
const FIXTURE_BRIDGE = join(E2E_ROOT, 'fixtures/fake-bridge.cjs');

export const PULL_REQUEST_FIXTURE = '.e2e-pull-request.json';
export const GITHUB_REPOSITORIES_FIXTURE = '.e2e-github-repositories.json';

const GH_STUB = `#!/bin/sh
PULL_REQUEST="$HOME/${PULL_REQUEST_FIXTURE}"
GITHUB_REPOSITORIES="$HOME/${GITHUB_REPOSITORIES_FIXTURE}"
case "$1 $2" in
  "api user/repos"*) if [ -f "$GITHUB_REPOSITORIES" ]; then cat "$GITHUB_REPOSITORIES"; else echo "[]"; fi; exit 0 ;;
  "auth status") echo "github.com"; echo "  Logged in to github.com account e2e-user (keyring)"; exit 0 ;;
  "api user") echo "e2e-user"; exit 0 ;;
esac
case "$1 $2 $3" in
  "repo view") echo "main"; exit 0 ;;
esac
case "$1 $2" in
  "repo list") echo "[]"; exit 0 ;;
  "pr list") if [ -f "$PULL_REQUEST" ]; then printf '['; cat "$PULL_REQUEST"; echo ']'; else echo "[]"; fi; exit 0 ;;
  "pr view") if [ -f "$PULL_REQUEST" ]; then cat "$PULL_REQUEST"; exit 0; fi; echo "no pull requests found for branch" 1>&2; exit 1 ;;
esac
exit 0
`;

const DOCKER_STUB = `#!/bin/sh
exit 0
`;

export interface MaliniEvent {
	seq: number;
	sessionId: string;
	runId: string;
	event: { type: string } & Record<string, unknown>;
}

export interface ProjectRow {
	id: string;
	name: string;
	repoPath: string;
	defaultBranch: string;
	createdAt: string;
	remoteUrl: string | null;
}

export interface WorkstreamRow {
	id: string;
	projectId: string;
	name: string;
	path: string;
	branch: string;
	baseBranch: string;
	status: string;
	createdAt: string;
}

export interface SessionRow {
	id: string;
	workstreamId: string;
	displayName: string;
	provider: string;
	model: string | null;
	status: string;
	startedAt: string;
}

export interface LaunchOptions {
	readonly allowedDiagnostics?: readonly RegExp[];
	readonly profile?: string;
	readonly env?: Readonly<Record<string, string>>;
}

export interface LaunchedApp {
	readonly electronApp: ElectronApplication;
	readonly page: Page;
	readonly root: string;
	readonly home: string;
	readonly bin: string;
	readonly userDataDir: string;
	readonly bridgeScript: string;
	readonly consoleErrors: string[];
	readonly pageErrors: string[];
	readonly allowedDiagnostics: readonly RegExp[];
	quit(): Promise<void>;
	close(): Promise<void>;
}

function stringEnv(base: NodeJS.ProcessEnv): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(base)) {
		if (value !== undefined) out[key] = value;
	}
	return out;
}

export async function launchMalini(options: LaunchOptions = {}): Promise<LaunchedApp> {
	const root = options.profile ?? mkdtempSync(join(tmpdir(), 'malini-e2e-'));
	const home = join(root, 'home');
	const bin = join(root, 'bin');
	const userDataDir = join(root, 'user-data');
	const ghDir = join(home, '.local/bin');
	for (const dir of [home, bin, userDataDir, ghDir]) mkdirSync(dir, { recursive: true });

	for (const dir of [bin, ghDir]) {
		for (const [name, script] of [
			['gh', GH_STUB],
			['docker', DOCKER_STUB],
		] as const) {
			const stub = join(dir, name);
			writeFileSync(stub, script);
			chmodSync(stub, 0o755);
		}
	}

	writeFileSync(join(home, '.profile'), `PATH="${bin}:$PATH"\nexport PATH\n`);

	const bridgeSource = readFileSync(FIXTURE_BRIDGE, 'utf8')
		.replaceAll('__VERSION__', String(BRIDGE_PROTOCOL_VERSION))
		.replaceAll('__CONTRACT__', BRIDGE_CONTRACT_NAME)
		.replaceAll('__HEARTBEAT_INTERVAL__', String(BRIDGE_HEARTBEAT_INTERVAL_MS));
	const bridgeScript = join(root, 'fake-bridge.cjs');
	writeFileSync(bridgeScript, bridgeSource);

	const env = stringEnv(process.env);
	env['SHELL'] = '/bin/sh';
	env['HOME'] = home;
	env['PATH'] = `${bin}:${env['PATH'] ?? '/usr/bin:/bin'}`;
	env['MALINI_BRIDGE_SCRIPT'] = bridgeScript;
	env['FAKE_BRIDGE_REVERSE_ACKS'] = '0';
	env['MALINI_USAGE_DATA'] = 'off';
	env['MALINI_BACKGROUND_WINDOW'] = '1';
	Object.assign(env, options.env);

	const electronApp = await electron.launch({
		args: ['.', `--user-data-dir=${userDataDir}`],
		cwd: APP_ROOT,
		env,
	});
	const output: string[] = [];
	const keepOutput = (chunk: Buffer): void => {
		output.push(chunk.toString('utf8'));
		if (output.length > 200) output.shift();
	};
	electronApp.process().stdout?.on('data', keepOutput);
	electronApp.process().stderr?.on('data', keepOutput);
	const page = await electronApp.firstWindow();

	const consoleErrors: string[] = [];
	const pageErrors: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'error') consoleErrors.push(message.text());
	});
	page.on('pageerror', (error) => pageErrors.push(error.message));

	let quitting: Promise<void> | null = null;
	const handle: LaunchedApp = {
		electronApp,
		page,
		root,
		home,
		bin,
		userDataDir,
		bridgeScript,
		consoleErrors,
		pageErrors,
		allowedDiagnostics: options.allowedDiagnostics ?? [],
		quit() {
			quitting ??= (async () => {
				await waitForQuietDiagnostics(userDataDir);
				await closeOrExplain(electronApp, userDataDir, output);
				const unexpected = unexpectedDiagnostics(userDataDir, handle.allowedDiagnostics);
				expect
					.soft(
						unexpected.map(diagnosticText),
						'error diagnostics or error toasts appeared during this test; fix them, or allow the intentional ones with launchMalini({ allowedDiagnostics })',
					)
					.toEqual([]);
			})();
			return quitting;
		},
		async close() {
			try {
				await handle.quit();
			} finally {
				if (process.env['MALINI_E2E_KEEP'] === '1') {
					console.error(`malini-e2e kept profile at ${root}`);
				} else {
					rmSync(root, { recursive: true, force: true });
				}
			}
		},
	};
	return handle;
}

const QUIT_BUDGET_MS = 15_000;

async function closeOrExplain(
	electronApp: ElectronApplication,
	userDataDir: string,
	output: readonly string[],
): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const stalled = new Promise<'stalled'>((resolve) => {
		timer = setTimeout(() => resolve('stalled'), QUIT_BUDGET_MS);
	});
	const closed = async (): Promise<'closed'> => {
		await electronApp.close();
		return 'closed';
	};
	const outcome = await Promise.race([closed(), stalled]);
	clearTimeout(timer);
	if (outcome === 'closed') return;
	const child = electronApp.process();
	const table = await processTable();
	const tree = processTree(table, child.pid ?? -1);
	for (const line of tree) {
		const pid = Number(line.trim().split(/\s+/u)[0]);
		if (Number.isSafeInteger(pid) && pid > 0) {
			try {
				process.kill(pid, 'SIGKILL');
			} catch {}
		}
	}
	const diagnostics = diagnosticsLogFiles(userDataDir)
		.filter(fileExists)
		.flatMap((path) => readFileSync(path, 'utf8').split('\n'))
		.filter((line) => line.includes('"level":"error"'))
		.slice(-10)
		.map((line) => line.slice(0, 4_000));
	throw new Error(
		[
			`the app did not quit within ${QUIT_BUDGET_MS} ms (exit code ${String(child.exitCode)}, signal ${String(child.signalCode)})`,
			'process tree:',
			...tree,
			'last output:',
			output.join('').split('\n').slice(-60).join('\n'),
			'last diagnostics:',
			...diagnostics,
		].join('\n'),
	);
}

async function processTable(): Promise<string> {
	try {
		return (await execFileAsync('ps', ['-A', '-o', 'pid=,ppid=,stat=,command='])).stdout;
	} catch (error) {
		return String(error);
	}
}

function processTree(table: string, rootPid: number): string[] {
	const rows = table
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const [pid = '', ppid = ''] = line.trim().split(/\s+/u);
			return { pid: Number(pid), ppid: Number(ppid), line };
		});
	const members = new Set([rootPid]);
	for (let grew = true; grew;) {
		grew = false;
		for (const row of rows) {
			if (members.has(row.ppid) && !members.has(row.pid)) {
				members.add(row.pid);
				grew = true;
			}
		}
	}
	return rows.filter((row) => members.has(row.pid)).map((row) => row.line);
}

export async function invoke<T = unknown>(page: Page, command: string, args?: unknown): Promise<T>;
export async function invoke(page: Page, command: string, args: unknown = {}): Promise<unknown> {
	return page.evaluate(
		async ({ command, args }) => {
			try {
				return await globalThis.malini.invoke(command, args);
			} catch (failure) {
				const reason =
					typeof failure === 'object' && failure !== null && 'message' in failure
						? String(failure.message)
						: String(failure);
				throw new Error(`${command} failed: ${reason}`);
			}
		},
		{ command, args },
	);
}

export async function listProjects(page: Page): Promise<ProjectRow[]> {
	return invoke<ProjectRow[]>(page, 'repositories.list-repositories', undefined);
}

export async function listSessions(page: Page, workstreamId: string): Promise<SessionRow[]> {
	return invoke<SessionRow[]>(page, 'chat.list-sessions', { workstreamId });
}

export async function listEvents(page: Page, sessionId: string): Promise<MaliniEvent[]> {
	return invoke<MaliniEvent[]>(page, 'chat.list-events', {
		sessionId,
		afterSeq: 0,
	});
}

export async function createSourceRepo(root: string, name = 'source'): Promise<string> {
	const repo = join(root, name);
	mkdirSync(repo, { recursive: true });
	await git(repo, ['init', '-b', 'main']);
	await git(repo, ['config', 'user.email', 'e2e@example.com']);
	await git(repo, ['config', 'user.name', 'e2e']);
	writeFileSync(join(repo, 'seed.txt'), 'seed\n');
	await git(repo, ['add', '.']);
	await git(repo, ['commit', '-m', 'seed']);
	return repo;
}

export interface SeededWorkstream {
	workstreamId: string;
	projectId: string;
	basePath: string;
	worktree: string;
}

export async function seedWorkstream(
	page: Page,
	sourceRepo: string,
	workstreamId: string,
	name: string,
): Promise<SeededWorkstream> {
	const basePath = await invoke<string>(page, 'repositories.create-repository', {
		repoUrl: sourceRepo,
	});
	const projects = await listProjects(page);
	const project = projects.find((candidate) => candidate.repoPath === basePath);
	if (!project) throw new Error(`repositories.list-repositories did not return ${basePath}`);
	const worktree = await invoke<string>(page, 'repositories.create-workstream', {
		projectRepoPath: basePath,
		workstreamId,
		baseBranch: 'main',
		projectId: project.id,
		name,
	});
	return { workstreamId, projectId: project.id, basePath, worktree };
}

export async function openWorkstream(
	page: Page,
	workstreamId: string,
	sessionId?: string,
): Promise<void> {
	const hash = sessionId
		? `#/workstreams/${encodeURIComponent(workstreamId)}?agent=${sessionId}`
		: `#/workstreams/${encodeURIComponent(workstreamId)}`;
	await page.evaluate((next) => {
		globalThis.location.hash = next;
	}, hash);
	await page.reload();
	await expect(page.getByTestId('transcript-pane')).toBeVisible({ timeout: 20_000 });
}

function composer(page: Page) {
	return page.locator('[data-testid="chat-composer-input"][aria-disabled="false"]');
}

export async function sendPrompt(page: Page, text: string): Promise<void> {
	const input = composer(page);
	await expect(input).toBeVisible({ timeout: 20_000 });
	const box = await input.boundingBox();
	if (!box) throw new Error('the composer is not laid out');
	await input.click({ position: { x: box.width - 4, y: box.height / 2 } });
	await page.keyboard.type(text, { delay: 10 });
	const submit = page.getByTestId('chat-composer-submit');
	await expect(submit).toBeEnabled({ timeout: 15_000 });
	await submit.click();
}

export async function expectAssistantReply(page: Page, timeout = 30_000): Promise<void> {
	await expect(page.getByTestId('chat-message-bubble').first()).toContainText(
		'Hello from the fake bridge',
		{ timeout },
	);
}

export async function expectStoppedChatIsNeutral(page: Page, sessionId: string): Promise<void> {
	const tab = page.locator(`[data-testid="chat-agent-tab"][data-session-id="${sessionId}"]`);
	await expect(tab).toHaveRole('tab');
	await expect(tab).toHaveAccessibleDescription('', { timeout: 15_000 });
	await expect(page.getByLabel(/Workstream status: Failed/u)).toHaveCount(0);
}

export function currentSessionId(page: Page): string | null {
	const match = /(?:[?&])agent=([^&]+)/u.exec(page.url());
	return match?.[1] ?? null;
}

export async function startFreshChat(page: Page): Promise<void> {
	const previous = currentSessionId(page);
	await page.getByTestId('chat-agent-new').click();
	await expect.poll(() => currentSessionId(page), { timeout: 20_000 }).not.toBe(previous);
	await expect(page.getByTestId('chat-fresh-session')).toBeVisible({ timeout: 20_000 });
	await expect(composer(page)).toBeVisible({ timeout: 20_000 });
}

export async function selectChat(page: Page, sessionId: string): Promise<void> {
	await page.locator(`[data-testid="chat-agent-tab"][data-session-id="${sessionId}"]`).click();
	await expect(
		page.locator(`[data-testid="chat-message-viewport"][data-session-id="${sessionId}"]`),
	).toBeVisible({ timeout: 20_000 });
}

export interface TwoChats {
	workstreamId: string;
	worktree: string;
	chatA: string;
	chatB: string;
}

export async function seedTwoChats(
	page: Page,
	sourceRepo: string,
	workstreamId: string,
	name: string,
): Promise<TwoChats> {
	const seeded = await seedWorkstream(page, sourceRepo, workstreamId, name);
	await openWorkstream(page, seeded.workstreamId);

	await sendPrompt(page, 'EDIT:a.txt');
	await expectAssistantReply(page);
	const chatA = currentSessionId(page);
	if (!chatA) throw new Error('chat A did not commit a session id');

	await startFreshChat(page);
	await sendPrompt(page, 'EDIT:b.txt');
	await expectAssistantReply(page);
	const chatB = currentSessionId(page);
	if (!chatB) throw new Error('chat B did not commit a session id');

	return { workstreamId: seeded.workstreamId, worktree: seeded.worktree, chatA, chatB };
}

export async function undoRun(page: Page, runId: string): Promise<void> {
	const row = page.locator(`li[data-run-id="${runId}"]`);
	const arm = row.getByTestId('chat-run-undo-arm');
	await expect(arm).toBeEnabled({ timeout: 20_000 });
	await arm.click();
	const confirm = row.getByTestId('chat-run-undo-confirm');
	await expect(confirm).toBeVisible({ timeout: 20_000 });
	await confirm.click();
}

export async function visibleRunIds(page: Page): Promise<string[]> {
	return page
		.locator('li[data-run-id]')
		.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-run-id') ?? ''));
}

export async function snapshotRefs(worktree: string): Promise<string[]> {
	const { stdout } = await execFileAsync('git', ['-C', worktree, 'for-each-ref', 'refs/malini'], {
		env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
	});
	return stdout
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

export function fileExists(path: string): boolean {
	try {
		accessSync(path);
		return true;
	} catch {
		return false;
	}
}

export async function git(repo: string, args: readonly string[]): Promise<void> {
	await execFileAsync('git', [...args], {
		cwd: repo,
		env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
	});
}

export async function captureFlow(
	handle: LaunchedApp,
	name: string,
): Promise<{ page: string; native: string | null }> {
	mkdirSync(CONTEXT_ROOT, { recursive: true });
	const pagePath = join(CONTEXT_ROOT, `e2e-${name}.png`);
	await handle.page.screenshot({ path: pagePath });
	let nativePath: string | null = null;
	try {
		const mediaSourceId = await handle.electronApp.evaluate(({ BrowserWindow }) => {
			const [first] = BrowserWindow.getAllWindows();
			return first ? first.getMediaSourceId() : null;
		});
		const windowId = mediaSourceId ? /^window:(\d+)/u.exec(mediaSourceId)?.[1] : undefined;
		if (windowId) {
			nativePath = join(CONTEXT_ROOT, `e2e-${name}-native.png`);
			await execFileAsync('screencapture', ['-o', '-x', '-l', windowId, nativePath]);
		}
	} catch {
		nativePath = null;
	}
	return { page: pagePath, native: nativePath };
}

export function unexpectedDiagnostics(
	userDataDir: string,
	allowed: readonly RegExp[],
): DiagnosticEntry[] {
	return readDiagnostics(userDataDir, { minimumLevel: 'error' }).filter(
		(entry) => !allowed.some((pattern) => pattern.test(diagnosticText(entry))),
	);
}

export function diagnosticText(entry: DiagnosticEntry): string {
	const source = entry.command === null ? entry.source : `${entry.source} ${entry.command}`;
	const name = entry.errorName === null ? '' : `${entry.errorName}: `;
	return `${entry.process} ${source} ${name}${entry.message}`;
}

export async function waitForQuietDiagnostics(userDataDir: string): Promise<void> {
	let previous = diagnosticsSignature(userDataDir);
	let quietChecks = 0;
	for (let attempt = 0; attempt < 40 && quietChecks < 3; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		const current = diagnosticsSignature(userDataDir);
		quietChecks = current === previous ? quietChecks + 1 : 0;
		previous = current;
	}
}

function diagnosticsSignature(userDataDir: string): string {
	return diagnosticsLogFiles(userDataDir)
		.map((path) => (fileExists(path) ? `${path}:${readFileSync(path).byteLength}` : path))
		.join('|');
}

export function expectCleanConsole(handle: LaunchedApp): void {
	expect(handle.pageErrors, `page errors: ${handle.pageErrors.join('\n')}`).toEqual([]);
	expect(handle.consoleErrors, `console errors: ${handle.consoleErrors.join('\n')}`).toEqual([]);
}
