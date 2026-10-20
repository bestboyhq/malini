import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
	diagnosticsDirectory,
	diagnosticsLogFiles,
	memoryJournalFiles,
	readDiagnostics,
} from '../src/main/diagnostics/diagnostics-files.ts';

/** @typedef {import('../src/contract/diagnostics.ts').DiagnosticEntry} DiagnosticEntry */
/** @typedef {import('../src/contract/diagnostics.ts').DiagnosticLevel} DiagnosticLevel */
/** @typedef {import('../src/main/diagnostics/diagnostics-files.ts').MemoryJournalEntry} MemoryJournalEntry */

const USAGE = `Print malini's main-process and renderer diagnostics, merged by time, one line per entry.

usage: corepack pnpm --filter malini diagnostics [options]

  --since <10m|2h|1d|30s|ISO time>   only entries at or after this time
  --level <info|warn|error>          lowest level to print (default info: everything)
  --with-toasts                      also print toasts below --level (their text is kept only for warnings and errors)
  --limit <n>                        print at most the last n entries (default 200, 0 for all)
  --follow                           keep printing new entries as they are written
  --json                             print each entry as a JSON line
  --memory                           print the memory journal instead, one record every 30s (--since, --limit and --json apply)
  --dir <app data root>              read another profile (default: MALINI_APP_DATA or the malini user data folder)

line format: <time> <process> <level> <source> <message> [workstream=<id>] [viewing=<id>]
  workstream=<id>  the workstream the entry is about
  viewing=<id>     the workstream on screen when it happened, which may be a different one

memory format: <time> malini <total> in <n> processes (pid, start), the machine's memory and the main process heap, then
  by kind    what malini, its browser tabs, its agents and the tools they started hold
  heaviest   the heaviest processes in malini's tree
  outside    the heaviest processes outside it; ppid 1 after a restart means an orphan
  launchers  the processes that started malini, like pnpm dogfood and electron-vite
  sizes are macOS footprints, what Activity Monitor shows, unless the record says rss`;

const FOLLOW_INTERVAL_MS = 500;
const DEFAULT_LIMIT = 200;

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {NodeJS.Platform} platform
 * @param {string} home
 * @returns {string}
 */
export function defaultAppDataRoot(
	env = process.env,
	platform = process.platform,
	home = homedir(),
) {
	if (env['MALINI_APP_DATA']) return env['MALINI_APP_DATA'];
	if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'malini');
	if (platform === 'win32')
		return join(env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'malini');
	return join(env['XDG_CONFIG_HOME'] ?? join(home, '.config'), 'malini');
}

/**
 * @param {string} value
 * @param {number} now
 * @returns {Date}
 */
export function parseSince(value, now = Date.now()) {
	const relative = /^(\d+)(ms|s|m|h|d)$/u.exec(value.trim());
	if (relative) {
		const unit =
			{ ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[relative[2] ?? 'ms'] ?? 1;
		return new Date(now - Number(relative[1]) * unit);
	}
	const absolute = new Date(value);
	if (Number.isNaN(absolute.getTime())) {
		throw new Error(`--since expects a duration like 10m or an ISO time, got "${value}"`);
	}
	return absolute;
}

/**
 * @param {DiagnosticEntry} entry
 * @returns {string}
 */
export function formatEntry(entry) {
	const source = entry.command === null ? entry.source : `${entry.source} ${entry.command}`;
	const duration = entry.durationMs === null ? '' : ` (${entry.durationMs}ms)`;
	const name =
		entry.errorName === null
			? ''
			: `${entry.errorName}${entry.code === null ? '' : ` [${entry.code}]`}: `;
	const message = `${name}${entry.message}`.replace(/\s*\n\s*/gu, ' | ');
	const repeats =
		entry.suppressedRepeats > 0
			? `  (+${entry.suppressedRepeats} identical not logged before this)`
			: '';
	const workstream = entry.workstreamId === null ? '' : `  workstream=${entry.workstreamId}`;
	const viewing = entry.viewing === null ? '' : `  viewing=${entry.viewing}`;
	const line = `${entry.occurredAt}  ${entry.process.padEnd(8)} ${entry.level.padEnd(5)}  ${source}${duration}  ${message}${repeats}${workstream}${viewing}`;
	if (entry.detail === null) return line;
	return `${line}\n${entry.detail
		.split('\n')
		.map((detailLine) => `    ${detailLine}`)
		.join('\n')}`;
}

/**
 * @param {number} bytes
 * @returns {string}
 */
function size(bytes) {
	const gib = bytes / 1024 ** 3;
	return gib >= 1 ? `${gib.toFixed(1)}G` : `${Math.round(bytes / 1024 ** 2)}M`;
}

/**
 * @param {import('../src/main/diagnostics/diagnostics-files.ts').JournalProcess} row
 * @returns {string}
 */
function journalProcess(row) {
	return `${size(row.memoryBytes)} ${row.label} (pid ${row.pid}, ppid ${row.ppid})`;
}

/**
 * @param {MemoryJournalEntry} entry
 * @returns {string}
 */
export function formatMemoryEntry(entry) {
	const { app, machine, mainHeap } = entry;
	const physical =
		machine.physical === null
			? `${size(machine.totalBytes)} total`
			: `${size(machine.physical.usedBytes)} used, ${size(machine.physical.compressorBytes)} compressed, ${size(machine.physical.unusedBytes)} free`;
	const measure = entry.measure === 'rss' ? '  [rss]' : '';
	const heaviest = entry.breakdown
		.flatMap((kind) => kind.items.map((item) => ({ ...item, kind: kind.kind })))
		.sort((left, right) => right.memoryBytes - left.memoryBytes)
		.slice(0, 5)
		.map(
			(item) =>
				`${size(item.memoryBytes)} ${item.kind}: ${item.label}${item.workstream === null ? '' : ` [${item.workstream}]`}`,
		);
	return [
		`${entry.occurredAt}  malini ${size(app.memoryBytes)} in ${app.processes} processes (pid ${app.pid}, started ${app.startedAt})  machine ${physical}  main heap ${size(mainHeap.heapUsedBytes)}/${size(mainHeap.heapTotalBytes)}${measure}`,
		`    by kind    ${entry.usage.map((usage) => `${usage.kind} ${size(usage.memoryBytes)}`).join(' · ')}`,
		`    heaviest   ${heaviest.join(' · ')}`,
		`    outside    ${entry.outside.map(journalProcess).join(' · ')}`,
		`    launchers  ${entry.launchers.map(journalProcess).join(' · ')}`,
	].join('\n');
}

/**
 * @param {string} appDataRoot
 * @param {Date | null} since
 * @returns {MemoryJournalEntry[]}
 */
export function readMemoryJournal(appDataRoot, since) {
	const from = since?.getTime() ?? Number.NEGATIVE_INFINITY;
	return memoryJournalFiles(appDataRoot)
		.flatMap((path) => {
			try {
				return readFileSync(path, 'utf8').split('\n');
			} catch {
				return [];
			}
		})
		.flatMap((line) => {
			try {
				return line.trim() === '' ? [] : [JSON.parse(line)];
			} catch {
				return [];
			}
		})
		.filter((entry) => Date.parse(entry.occurredAt) >= from);
}

/**
 * @param {DiagnosticEntry} entry
 * @returns {string}
 */
function entryKey(entry) {
	return `${entry.process}|${entry.occurredAt}|${entry.source}|${entry.message}`;
}

/**
 * @param {string[]} argv
 */
function parseOptions(argv) {
	const { values } = parseArgs({
		args: argv,
		options: {
			since: { type: 'string' },
			level: { type: 'string', default: 'info' },
			limit: { type: 'string' },
			follow: { type: 'boolean', default: false },
			json: { type: 'boolean', default: false },
			'with-toasts': { type: 'boolean', default: false },
			memory: { type: 'boolean', default: false },
			dir: { type: 'string' },
			help: { type: 'boolean', short: 'h', default: false },
		},
		strict: true,
	});
	const level = levelOption(values.level);
	const limit = values.limit === undefined ? DEFAULT_LIMIT : Number(values.limit);
	if (!Number.isInteger(limit) || limit < 0)
		throw new Error(`--limit expects a whole number, got "${values.limit}"`);
	return {
		help: values.help,
		since: values.since === undefined ? null : parseSince(values.since),
		level,
		limit,
		follow: values.follow,
		json: values.json,
		withToasts: values['with-toasts'],
		memory: values.memory,
		appDataRoot: values.dir ?? defaultAppDataRoot(),
	};
}

/**
 * @param {string} value
 * @returns {DiagnosticLevel}
 */
function levelOption(value) {
	if (value === 'info' || value === 'warn' || value === 'error') return value;
	throw new Error(`--level must be info, warn or error, got "${value}"`);
}

/**
 * @param {string} appDataRoot
 * @returns {string}
 */
function filesSignature(appDataRoot) {
	return diagnosticsLogFiles(appDataRoot)
		.map((path) => {
			try {
				const stats = statSync(path);
				return `${path}:${stats.size}:${stats.mtimeMs}`;
			} catch {
				return `${path}:missing`;
			}
		})
		.join('|');
}

/**
 * @param {string[]} argv
 * @param {(line: string) => void} print
 * @returns {Promise<void>}
 */
export async function run(argv, print = (line) => process.stdout.write(`${line}\n`)) {
	const options = parseOptions(argv);
	if (options.help) {
		print(USAGE);
		return;
	}
	if (options.memory) {
		const entries = readMemoryJournal(options.appDataRoot, options.since);
		const shown = options.limit === 0 ? entries : entries.slice(-options.limit);
		for (const entry of shown)
			print(options.json ? JSON.stringify(entry) : formatMemoryEntry(entry));
		if (shown.length === 0) {
			process.stderr.write(
				`no memory journal records in ${diagnosticsDirectory(options.appDataRoot)}\n`,
			);
		}
		return;
	}
	const render = options.json
		? (/** @type {DiagnosticEntry} */ entry) => JSON.stringify(entry)
		: formatEntry;
	const query = {
		since: options.since,
		minimumLevel: options.level,
		withToasts: options.withToasts,
	};
	const initial = readDiagnostics(options.appDataRoot, {
		...query,
		...(options.limit === 0 ? {} : { limit: options.limit }),
	});
	for (const entry of initial) print(render(entry));
	if (initial.length === 0 && !options.follow) {
		process.stderr.write(`no diagnostics match in ${diagnosticsDirectory(options.appDataRoot)}\n`);
	}
	if (!options.follow) return;

	const printed = new Set(readDiagnostics(options.appDataRoot, query).map(entryKey));
	let signature = filesSignature(options.appDataRoot);
	for (;;) {
		await new Promise((resolve) => setTimeout(resolve, FOLLOW_INTERVAL_MS));
		const next = filesSignature(options.appDataRoot);
		if (next === signature) continue;
		signature = next;
		for (const entry of readDiagnostics(options.appDataRoot, query)) {
			const key = entryKey(entry);
			if (printed.has(key)) continue;
			printed.add(key);
			print(render(entry));
		}
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		await run(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}\n`);
		process.exitCode = 2;
	}
}
