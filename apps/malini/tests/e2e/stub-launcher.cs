using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;

static class StubLauncher
{
	const string GitBash = "GIT_BASH";
	const int UseStandardHandles = 0x100;
	const int Infinite = -1;

	[StructLayout(LayoutKind.Sequential)]
	struct StartupInfo
	{
		public int size;
		public IntPtr reserved;
		public IntPtr desktop;
		public IntPtr title;
		public int x;
		public int y;
		public int width;
		public int height;
		public int columns;
		public int rows;
		public int fillAttribute;
		public int flags;
		public short showWindow;
		public short reservedSize;
		public IntPtr reservedBytes;
		public IntPtr input;
		public IntPtr output;
		public IntPtr error;
	}

	[StructLayout(LayoutKind.Sequential)]
	struct ProcessInformation
	{
		public IntPtr process;
		public IntPtr thread;
		public int processId;
		public int threadId;
	}

	[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "CreateProcessW")]
	static extern bool CreateProcess(
		string application,
		StringBuilder commandLine,
		IntPtr processAttributes,
		IntPtr threadAttributes,
		bool inheritHandles,
		int creationFlags,
		IntPtr environment,
		string currentDirectory,
		ref StartupInfo startupInfo,
		out ProcessInformation processInformation);

	[DllImport("kernel32.dll")]
	static extern IntPtr GetStdHandle(int which);

	[DllImport("kernel32.dll")]
	static extern int WaitForSingleObject(IntPtr handle, int milliseconds);

	[DllImport("kernel32.dll")]
	static extern bool GetExitCodeProcess(IntPtr process, out int exitCode);

	const string ShellBoot =
		@"IFS=$' \t\n'; set +f; i=0; while [ ""$i"" -lt ""$MALINI_STUB_ARGC"" ]; do " +
		@"name=MALINI_STUB_ARG_$i; set -- ""$@"" ""${!name}""; unset ""$name""; i=$((i + 1)); done; " +
		@"unset i name MALINI_STUB_ARGC MALINI_STUB_BOOT; . ""$0""";

	static int Main(string[] args)
	{
		string self = Assembly.GetEntryAssembly().Location;
		string script = self.Substring(0, self.Length - ".exe".Length);
		string runner = Runner(script);
		Environment.SetEnvironmentVariable("MSYS_NO_PATHCONV", "1");
		StringBuilder commandLine = new StringBuilder(
			runner == GitBash ? ShellCommandLine(script, args) : NodeCommandLine(runner, script));
		StartupInfo startup = new StartupInfo();
		startup.size = Marshal.SizeOf(typeof(StartupInfo));
		startup.flags = UseStandardHandles;
		startup.input = GetStdHandle(-10);
		startup.output = GetStdHandle(-11);
		startup.error = GetStdHandle(-12);
		ProcessInformation child;
		if (!CreateProcess(null, commandLine, IntPtr.Zero, IntPtr.Zero, true, 0, IntPtr.Zero, null, ref startup, out child))
		{
			Console.Error.WriteLine("could not start " + runner + ": Windows error " + Marshal.GetLastWin32Error());
			return 127;
		}
		WaitForSingleObject(child.process, Infinite);
		int exitCode;
		GetExitCodeProcess(child.process, out exitCode);
		return exitCode;
	}

	static string Runner(string script)
	{
		string firstLine;
		using (StreamReader reader = new StreamReader(script)) firstLine = reader.ReadLine() ?? "";
		string shebang = firstLine.StartsWith("#!") ? firstLine.Substring(2).Trim() : "";
		bool windowsProgram = shebang.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && File.Exists(shebang);
		return windowsProgram ? shebang : GitBash;
	}

	static string ShellCommandLine(string script, string[] args)
	{
		Environment.SetEnvironmentVariable("MALINI_STUB_BOOT", ShellBoot);
		Environment.SetEnvironmentVariable("MALINI_STUB_ARGC", args.Length.ToString());
		for (int i = 0; i < args.Length; i++) Environment.SetEnvironmentVariable("MALINI_STUB_ARG_" + i, args[i]);
		return "\"" + GitBash + "\" -c \"set -f; IFS=; eval $MALINI_STUB_BOOT\" \"" + script + "\"";
	}

	static string NodeCommandLine(string runner, string script)
	{
		return "\"" + runner + "\" \"" + script + "\"" + ArgumentsAfterProgram(Environment.CommandLine);
	}

	static string ArgumentsAfterProgram(string commandLine)
	{
		int end;
		if (commandLine.StartsWith("\""))
		{
			end = commandLine.IndexOf('"', 1);
			return end < 0 ? "" : commandLine.Substring(end + 1);
		}
		end = 0;
		while (end < commandLine.Length && commandLine[end] != ' ' && commandLine[end] != '\t') end++;
		return commandLine.Substring(end);
	}
}
