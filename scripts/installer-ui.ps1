# Native window inspection/capture: no global mouse or keyboard input and no desktop screenshots.
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;
public class InstallerControl {
  public IntPtr Handle; public string Text; public string ClassName; public int Id; public bool Visible; public bool Enabled; public int Width; public int Height; public bool Bitmap; public int Left; public int Top;
}
public static class InstallerWindow {
  public delegate bool Callback(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback cb, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, Callback cb, IntPtr p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll",EntryPoint="GetWindowLongW")] static extern int GetWindowStyle(IntPtr h,int index);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int command);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,StringBuilder l);
  [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="SendMessageW")] public static extern IntPtr SetText(IntPtr h,uint m,IntPtr w,string l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
  [DllImport("user32.dll")] public static extern bool RedrawWindow(IntPtr h,IntPtr r,IntPtr region,uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  static InstallerControl Read(IntPtr h) {
    var s=new StringBuilder(4096); SendMessage(h,0xD,(IntPtr)s.Capacity,s);
    var c=new StringBuilder(128);GetClassName(h,c,c.Capacity);
    Rect r; GetWindowRect(h,out r);
    return new InstallerControl {Handle=h,Text=s.ToString(),ClassName=c.ToString(),Id=GetDlgCtrlID(h),Visible=IsWindowVisible(h),Enabled=IsWindowEnabled(h),Width=r.Right-r.Left,Height=r.Bottom-r.Top,Bitmap=c.ToString()=="Static" && (GetWindowStyle(h,-16)&31)==14,Left=r.Left,Top=r.Top};
  }
  public static InstallerControl[] Windows(int pid) {
    var list=new List<InstallerControl>();
    EnumWindows((h,p)=> {uint owner; GetWindowThreadProcessId(h,out owner);if(owner==pid)list.Add(Read(h));return true;},IntPtr.Zero);
    return list.ToArray();
  }
  public static InstallerControl[] Children(IntPtr root) {
    var list=new List<InstallerControl>();EnumChildWindows(root,(h,p)=>{list.Add(Read(h));return true;},IntPtr.Zero);return list.ToArray();
  }
}
'@
function Get-InstallerControls([IntPtr]$Handle) { @([InstallerWindow]::Children($Handle) | Where-Object Visible) }
function Get-InstallerWindow([int]$ProcessId) {
  @([InstallerWindow]::Windows($ProcessId) | Where-Object { $_.Visible -and $_.ClassName -eq '#32770' }) | Select-Object -Last 1
}
function Wait-InstallerText([int]$ProcessId, [string]$Text, [int]$TimeoutSeconds = 20) {
  $until = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
      throw "Installer process exited before reaching: $Text"
    }
    foreach ($window in [InstallerWindow]::Windows($ProcessId)) {
      if (-not $window.Visible -and $window.ClassName -eq '#32770') { [void][InstallerWindow]::ShowWindow($window.Handle,4) }
      if (-not $window.Visible) { continue }
      $controls = @(Get-InstallerControls $window.Handle)
      if (($controls.Text -join "`n").Contains($Text)) { return $window }
    }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $until)
  $visibleState = @([InstallerWindow]::Windows($ProcessId) | Where-Object Visible | ForEach-Object { Get-InstallerControls $_.Handle | Select-Object Text,ClassName,Enabled,Id })
  $visibleState | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $PSScriptRoot '../artifacts/installer-timeout.json') -Encoding utf8
  foreach ($window in [InstallerWindow]::Windows($ProcessId) | Where-Object { $_.Visible -and $_.ClassName -eq '#32770' }) {
    Save-InstallerWindow $window.Handle (Join-Path $PSScriptRoot '../artifacts/screenshots/installer-timeout.png')
  }
  throw "Installer UI timed out: $Text"
}
function Invoke-InstallerButton([IntPtr]$Window, [string]$Text) {
  $control = Get-InstallerControls $Window | Where-Object { $_.ClassName -eq 'Button' -and $_.Text.Replace('&','') -eq $Text } | Select-Object -First 1
  if (-not $control) { throw "Installer button missing: $Text" }
  [void][InstallerWindow]::PostMessage($control.Handle, 0xF5, [IntPtr]::Zero, [IntPtr]::Zero)
}
function Save-InstallerWindow([IntPtr]$Handle, [string]$Path) {
  # Text controls exist before nsDialogs finishes its page transition and first paint.
  Start-Sleep -Milliseconds 1000
  [void][InstallerWindow]::RedrawWindow($Handle,[IntPtr]::Zero,[IntPtr]::Zero,0x185)
  $rect = [InstallerWindow+Rect]::new()
  if (-not [InstallerWindow]::GetWindowRect($Handle,[ref]$rect)) { throw 'Window bounds unavailable' }
  $bitmap = [Drawing.Bitmap]::new($rect.Right-$rect.Left,$rect.Bottom-$rect.Top)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $dc = $graphics.GetHdc()
  try { if (-not [InstallerWindow]::PrintWindow($Handle,$dc,2)) { throw 'PrintWindow failed' } }
  finally { $graphics.ReleaseHdc($dc); $graphics.Dispose() }
  try { $bitmap.Save($Path,[Drawing.Imaging.ImageFormat]::Png) } finally { $bitmap.Dispose() }
}
