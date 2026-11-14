using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

static class SuspendProcess
{
	[DllImport("ntdll.dll")]
	static extern int NtSuspendProcess(IntPtr process);

	[DllImport("ntdll.dll")]
	static extern int NtResumeProcess(IntPtr process);

	static int Main(string[] args)
	{
		using (Process process = Process.GetProcessById(int.Parse(args[0])))
		{
			int status = NtSuspendProcess(process.Handle);
			if (status != 0)
			{
				Console.Error.WriteLine("could not suspend " + args[0] + ": NTSTATUS 0x" + status.ToString("x8"));
				return 1;
			}
			try
			{
				Thread.Sleep(int.Parse(args[1]));
			}
			finally
			{
				NtResumeProcess(process.Handle);
			}
		}
		return 0;
	}
}
