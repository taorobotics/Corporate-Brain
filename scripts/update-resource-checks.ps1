Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class UpdateResourceQuery {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int id);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern uint GetPriorityClass(IntPtr handle);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr handle, int kind, out uint value, uint size, out uint returned);
  public static uint[] Read(int id) {
    IntPtr handle=OpenProcess(0x1400,false,id);
    if(handle==IntPtr.Zero) throw new InvalidOperationException("Cannot query owned update process");
    try {
      uint io, returned, cpu=GetPriorityClass(handle);
      if(cpu==0 || NtQueryInformationProcess(handle,33,out io,4,out returned)!=0)
        throw new InvalidOperationException("Cannot verify CPU and I/O scheduling");
      return new uint[]{cpu,io};
    } finally { CloseHandle(handle); }
  }
}
'@
function Assert-UpdateScheduling([Diagnostics.Process]$Client, [switch]$Background) {
  $priority = [UpdateResourceQuery]::Read($Client.Id)
  if ($Background) {
    if ($priority[0] -notin @(0x40,0x4000) -or $priority[1] -ge 2) { throw "Update did not lower CPU and disk priority: $priority" }
  } elseif ($priority[0] -ne 0x20 -or $priority[1] -ne 2) { throw "Foreground client did not retain normal CPU and disk priority: $priority" }
  return @{cpuClass=$priority[0];ioPriority=$priority[1]}
}
