import type { ProcessHandle, ProcessRunner } from '$main/process/runner';
import {
	parseWindowsProcessTable,
	powerShellArgs,
	WINDOWS_POWERSHELL,
	type CpuTimes,
	type ProcessRow,
} from './process-tree';

const READER = String.raw`
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace Malini {
	public static class ProcessTable {
		[DllImport("ntdll.dll")]
		static extern int NtQuerySystemInformation(int informationClass, IntPtr information, int length, out int needed);
		[DllImport("ntdll.dll")]
		static extern int NtQueryInformationProcess(IntPtr process, int informationClass, IntPtr information, int length, out int needed);
		[DllImport("kernel32.dll")]
		static extern IntPtr OpenProcess(int access, bool inherit, int processId);
		[DllImport("kernel32.dll")]
		static extern bool CloseHandle(IntPtr handle);
		[DllImport("kernel32.dll")]
		static extern int WaitForSingleObject(IntPtr handle, int milliseconds);
		[DllImport("kernel32.dll")]
		static extern bool ReadProcessMemory(IntPtr process, IntPtr address, IntPtr into, IntPtr size, out IntPtr read);

		const int TooSmall = unchecked((int)0xC0000004);
		const int WaitTimeout = 0x102;
		const int Synchronize = 0x00100000;
		const int QueryLimited = 0x1000;
		const int VmRead = 0x0010;
		static readonly Dictionary<long, long> Described = new Dictionary<long, long>();

		public static void Run(long self, long app, int intervalMs) {
			IntPtr waitOn = OpenProcess(Synchronize, false, (int)app);
			if (waitOn == IntPtr.Zero) throw new InvalidOperationException("Malini is not running");
			Stream output = Console.OpenStandardOutput();
			Encoding utf8 = new UTF8Encoding(false);
			do {
				byte[] block = utf8.GetBytes(Block(self, app));
				output.Write(block, 0, block.Length);
				output.Flush();
			} while (WaitForSingleObject(waitOn, intervalMs) == WaitTimeout);
		}

		static string Block(long self, long app) {
			int size = 1 << 20;
			while (true) {
				IntPtr buffer = Marshal.AllocHGlobal(size);
				try {
					int needed;
					int status = NtQuerySystemInformation(5, buffer, size, out needed);
					long at = Stopwatch.GetTimestamp() * 1000 / Stopwatch.Frequency;
					if (status == 0) return Table(buffer, self, app) + "." + at + "\n";
					if (status != TooSmall) throw new InvalidOperationException("NtQuerySystemInformation " + status);
					size = Math.Max(size * 2, needed + 65536);
				} finally {
					Marshal.FreeHGlobal(buffer);
				}
			}
		}

		static string Table(IntPtr buffer, long self, long app) {
			List<IntPtr> entries = new List<IntPtr>();
			Dictionary<long, long> created = new Dictionary<long, long>();
			for (IntPtr entry = buffer; ; ) {
				entries.Add(entry);
				created[Pid(entry)] = Marshal.ReadInt64(entry, 0x20);
				int next = Marshal.ReadInt32(entry, 0);
				if (next == 0) break;
				entry = IntPtr.Add(entry, next);
			}
			Dictionary<long, long> parents = new Dictionary<long, long>();
			foreach (IntPtr entry in entries) {
				long parent = Marshal.ReadIntPtr(entry, 0x58).ToInt64();
				long parentCreated;
				bool older = created.TryGetValue(parent, out parentCreated) && parentCreated <= Marshal.ReadInt64(entry, 0x20);
				parents[Pid(entry)] = older ? parent : 0;
			}
			StringBuilder text = new StringBuilder();
			foreach (IntPtr entry in entries) {
				long pid = Pid(entry);
				int nameBytes = (ushort)Marshal.ReadInt16(entry, 0x38);
				IntPtr name = Marshal.ReadIntPtr(entry, 0x40);
				if (pid == 0 || pid == self || nameBytes == 0 || name == IntPtr.Zero) continue;
				text.Append(pid).Append(' ').Append(parents[pid]).Append(' ')
					.Append(Marshal.ReadInt64(entry, 0x08)).Append(' ')
					.Append(Marshal.ReadInt64(entry, 0x28) + Marshal.ReadInt64(entry, 0x30)).Append(' ')
					.Append(Marshal.PtrToStringUni(name, nameBytes / 2)).Append('\n');
				long createTime = Marshal.ReadInt64(entry, 0x20);
				long described;
				if (Described.TryGetValue(pid, out described) && described == createTime) continue;
				Described[pid] = createTime;
				Describe(text, pid, Descends(pid, app, parents));
			}
			foreach (long pid in new List<long>(Described.Keys)) {
				if (!created.ContainsKey(pid)) Described.Remove(pid);
			}
			return text.ToString();
		}

		static long Pid(IntPtr entry) {
			return Marshal.ReadIntPtr(entry, 0x50).ToInt64();
		}

		static bool Descends(long pid, long app, Dictionary<long, long> parents) {
			for (int depth = 0; depth < 64; depth++) {
				if (pid == app) return true;
				long parent;
				if (!parents.TryGetValue(pid, out parent) || parent == 0) return false;
				pid = parent;
			}
			return false;
		}

		static void Describe(StringBuilder text, long pid, bool own) {
			IntPtr process = own ? OpenProcess(QueryLimited | VmRead, false, (int)pid) : IntPtr.Zero;
			bool readable = process != IntPtr.Zero;
			if (!readable) process = OpenProcess(QueryLimited, false, (int)pid);
			string directory = null;
			string commandLine = null;
			if (process != IntPtr.Zero) {
				try {
					commandLine = CommandLine(process);
					if (readable) directory = WorkingDirectory(process);
				} finally {
					CloseHandle(process);
				}
			}
			text.Append('+').Append(pid).Append('\t').Append(directory).Append('\t')
				.Append(commandLine == null ? null : commandLine.Replace('\r', ' ').Replace('\n', ' ')).Append('\n');
		}

		static string CommandLine(IntPtr process) {
			int size = 4096;
			while (true) {
				IntPtr buffer = Marshal.AllocHGlobal(size);
				try {
					int needed;
					int status = NtQueryInformationProcess(process, 60, buffer, size, out needed);
					if (status == 0) {
						int length = (ushort)Marshal.ReadInt16(buffer, 0);
						IntPtr at = Marshal.ReadIntPtr(buffer, 8);
						return length == 0 || at == IntPtr.Zero ? null : Marshal.PtrToStringUni(at, length / 2);
					}
					if (status != TooSmall || needed <= size) return null;
					size = needed;
				} finally {
					Marshal.FreeHGlobal(buffer);
				}
			}
		}

		static string WorkingDirectory(IntPtr process) {
			IntPtr scratch = Marshal.AllocHGlobal(48);
			try {
				int needed;
				if (NtQueryInformationProcess(process, 0, scratch, 48, out needed) != 0) return null;
				IntPtr peb = Marshal.ReadIntPtr(scratch, 8);
				if (peb == IntPtr.Zero || !Read(process, IntPtr.Add(peb, 0x20), scratch, 8)) return null;
				IntPtr parameters = Marshal.ReadIntPtr(scratch);
				if (parameters == IntPtr.Zero || !Read(process, IntPtr.Add(parameters, 0x38), scratch, 16)) return null;
				int length = (ushort)Marshal.ReadInt16(scratch, 0);
				IntPtr at = Marshal.ReadIntPtr(scratch, 8);
				if (length == 0 || at == IntPtr.Zero) return null;
				IntPtr path = Marshal.AllocHGlobal(length);
				try {
					return Read(process, at, path, length) ? Marshal.PtrToStringUni(path, length / 2) : null;
				} finally {
					Marshal.FreeHGlobal(path);
				}
			} finally {
				Marshal.FreeHGlobal(scratch);
			}
		}

		static bool Read(IntPtr process, IntPtr address, IntPtr into, int size) {
			IntPtr read;
			return ReadProcessMemory(process, address, into, new IntPtr(size), out read) && read.ToInt64() == size;
		}
	}
}
`;

const DESCRIBED = /^\+(\d+)\t([^\t]*)\t(.*)$/u;
const BLOCK_END = /^\.(\d+)$/u;
const STALE_AFTER_BLOCKS = 3;
const BLOCK_TIMEOUT_MS = 60_000;
const RETRY_AFTER_MS = 60_000;

export class WindowsProcessTable {
	readonly #runner: ProcessRunner;
	readonly #appPid: number;
	readonly #intervalMs: number;
	readonly #commandLines = new Map<number, string>();
	readonly #directories = new Map<number, string>();
	readonly #waiting = new Set<(rows: ProcessRow[] | null) => void>();
	#reader: ProcessHandle | null = null;
	#startedAt = Number.NEGATIVE_INFINITY;
	#partial = '';
	#table: string[] = [];
	#cpuTimes: CpuTimes | null = null;
	#latest: { readonly rows: ProcessRow[]; readonly receivedAt: number } | null = null;

	constructor(runner: ProcessRunner, appPid: number, intervalMs: number) {
		this.#runner = runner;
		this.#appPid = appPid;
		this.#intervalMs = intervalMs;
	}

	get commandLines(): ReadonlyMap<number, string> {
		return this.#commandLines;
	}

	get workingDirectories(): ReadonlyMap<number, string> {
		return this.#directories;
	}

	async rows(): Promise<ProcessRow[] | null> {
		const latest = this.#latest;
		if (latest && Date.now() - latest.receivedAt < this.#intervalMs * STALE_AFTER_BLOCKS) {
			return latest.rows;
		}
		this.#start();
		if (!this.#reader) return null;
		return await new Promise((resolve) => {
			const timer = setTimeout(() => this.#halt(), BLOCK_TIMEOUT_MS);
			this.#waiting.add((rows) => {
				clearTimeout(timer);
				resolve(rows);
			});
		});
	}

	stop(): void {
		this.#halt();
		this.#startedAt = Number.NEGATIVE_INFINITY;
	}

	#start(): void {
		if (this.#reader || Date.now() - this.#startedAt < RETRY_AFTER_MS) return;
		this.#startedAt = Date.now();
		const reader = this.#runner.spawn(
			WINDOWS_POWERSHELL,
			readerArgs(this.#appPid, this.#intervalMs),
			{
				onStdout: (text) => {
					if (this.#reader === reader) this.#read(text);
				},
			},
		);
		this.#reader = reader;
		void this.#haltOnExit(reader);
	}

	async #haltOnExit(reader: ProcessHandle): Promise<void> {
		await reader.exit;
		if (this.#reader !== reader) return;
		this.#reader = null;
		this.#halt();
	}

	#halt(): void {
		const pid = this.#reader?.pid;
		this.#reader = null;
		if (pid) this.#runner.signalProcessGroup(pid, 'SIGKILL');
		this.#partial = '';
		this.#table = [];
		this.#cpuTimes = null;
		this.#latest = null;
		this.#settle(null);
	}

	#read(text: string): void {
		const lines = `${this.#partial}${text}`.split('\n');
		this.#partial = lines.pop() ?? '';
		for (const line of lines) {
			const end = BLOCK_END.exec(line);
			if (end) this.#finish(Number(end[1]));
			else if (line.startsWith('+')) this.#describe(line);
			else this.#table.push(line);
		}
	}

	#describe(line: string): void {
		const [, pid, directory, commandLine] = DESCRIBED.exec(line) ?? [];
		if (!pid) return;
		remember(this.#directories, Number(pid), directory);
		remember(this.#commandLines, Number(pid), commandLine?.trim());
	}

	#finish(at: number): void {
		const { rows, cpuTimes } = parseWindowsProcessTable(this.#table.join('\n'), at, this.#cpuTimes);
		this.#table = [];
		this.#cpuTimes = cpuTimes;
		const live = new Set(rows.map((row) => row.pid));
		for (const described of [this.#commandLines, this.#directories]) {
			for (const pid of described.keys()) if (!live.has(pid)) described.delete(pid);
		}
		this.#latest = { rows, receivedAt: Date.now() };
		this.#settle(rows);
	}

	#settle(rows: ProcessRow[] | null): void {
		const waiting = [...this.#waiting];
		this.#waiting.clear();
		for (const resolve of waiting) resolve(rows);
	}
}

function remember(described: Map<number, string>, pid: number, value: string | undefined): void {
	if (value) described.set(pid, value);
	else described.delete(pid);
}

function readerArgs(appPid: number, intervalMs: number): readonly string[] {
	return powerShellArgs(
		[
			"$ErrorActionPreference = 'Stop'",
			"Add-Type -TypeDefinition @'",
			READER.replace(/^\s+/gmu, ''),
			"'@",
			`[Malini.ProcessTable]::Run($PID, ${appPid}, ${intervalMs})`,
		].join('\n'),
	);
}
