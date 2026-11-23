param([Parameter(Mandatory)][int]$ProcessId)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class DesktopUser
{
	const int QueryLimitedInformation = 0x1000;
	const int AdjustPrivileges = 0x20;
	const int Query = 0x8;
	const int Removed = 0x4;

	[StructLayout(LayoutKind.Sequential, Pack = 4)]
	struct SinglePrivilege
	{
		public int count;
		public long luid;
		public int attributes;
	}

	[DllImport("kernel32.dll", SetLastError = true)]
	static extern IntPtr OpenProcess(int access, bool inheritHandle, int processId);

	[DllImport("advapi32.dll", SetLastError = true)]
	static extern bool OpenProcessToken(IntPtr process, int access, out IntPtr token);

	[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "LookupPrivilegeValueW")]
	static extern bool LookupPrivilegeValue(string system, string name, out long luid);

	[DllImport("advapi32.dll", SetLastError = true)]
	static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll, ref SinglePrivilege state, int length, IntPtr previous, IntPtr returnLength);

	[DllImport("kernel32.dll")]
	static extern bool CloseHandle(IntPtr handle);

	public static void Remove(int processId, string[] names)
	{
		IntPtr process = OpenProcess(QueryLimitedInformation, false, processId);
		if (process == IntPtr.Zero) throw new Win32Exception();
		IntPtr token;
		bool opened = OpenProcessToken(process, AdjustPrivileges | Query, out token);
		CloseHandle(process);
		if (!opened) throw new Win32Exception();
		try
		{
			foreach (string name in names)
			{
				SinglePrivilege state = new SinglePrivilege();
				state.count = 1;
				state.attributes = Removed;
				if (!LookupPrivilegeValue(null, name, out state.luid)) throw new Win32Exception();
				if (!AdjustTokenPrivileges(token, false, ref state, 0, IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception();
			}
		}
		finally
		{
			CloseHandle(token);
		}
	}
}
'@
[DesktopUser]::Remove($ProcessId, @('SeBackupPrivilege', 'SeRestorePrivilege'))
