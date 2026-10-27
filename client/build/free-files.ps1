# Освобождает папку Созвона перед установкой или удалением.
# Старый деинсталлятор при обновлении переносит файлы программы и сдаётся, если хоть один файл занят, —
# тогда установщик показывает «Не удалось закрыть Sozvon». Поэтому до него:
#   1) закрываем всё, что запущено из этой папки (по пути, а не по имени и пользователю);
#   2) ждём, пока файлы отпустят другие программы (обычно антивирус проверяет свежий exe);
#   3) Созвон, запущенный от имени администратора, закрываем с подтверждением Windows.
# Коды выхода: 0 — папка свободна, 3 — файлы держит другая программа (её имя — в файле -Report).
param([string]$Dir, [string]$Exe, [string]$Report, [int]$Seconds = 25)

$ErrorActionPreference = 'SilentlyContinue'
if (-not $Dir -or -not (Test-Path -LiteralPath $Dir)) { exit 0 }
$root = (Get-Item -LiteralPath $Dir).FullName.TrimEnd('\') + '\'

Add-Type -ErrorAction Stop @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class Locks {
  [StructLayout(LayoutKind.Sequential)] struct UNIQUE_PROCESS { public int Pid; public System.Runtime.InteropServices.ComTypes.FILETIME Start; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct INFO {
    public UNIQUE_PROCESS Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string AppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string Service;
    public int Type; public int Status; public int Session; [MarshalAs(UnmanagedType.Bool)] public bool Restartable; }
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmStartSession(out uint h, int f, string key);
  [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint h);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmRegisterResources(uint h, uint n, string[] files, uint a, IntPtr b, uint c, string[] d);
  [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint h, out uint need, ref uint n, [In, Out] INFO[] list, ref uint reasons);
  // Кто держит файлы: «pid|имя»
  public static List<string> Who(string[] files) {
    var result = new List<string>();
    uint h; if (RmStartSession(out h, 0, Guid.NewGuid().ToString()) != 0) return result;
    try {
      if (RmRegisterResources(h, (uint)files.Length, files, 0, IntPtr.Zero, 0, null) != 0) return result;
      uint need = 0, n = 0, reasons = 0;
      int rc = RmGetList(h, out need, ref n, null, ref reasons);
      if (rc == 234 && need > 0) {
        var list = new INFO[need]; n = need;
        if (RmGetList(h, out need, ref n, list, ref reasons) == 0)
          for (int i = 0; i < n; i++) result.Add(list[i].Process.Pid + "|" + list[i].AppName);
      }
    } finally { RmEndSession(h); }
    return result;
  }
}
"@

# Установщик или деинсталлятор, который нас запустил, не трогаем (деинсталлятор может работать прямо из папки)
$parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
$self = @($PID, $parent)

function Ours {
  Get-CimInstance Win32_Process | Where-Object {
    $self -notcontains $_.ProcessId -and (($_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, 'OrdinalIgnoreCase')) -or ($Exe -and $_.Name -eq $Exe))
  }
}

$files = @(Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.Extension -match '^\.(exe|dll|pak|asar|bin|dat|node|json)$' } | Select-Object -First 400 -ExpandProperty FullName)
$deadline = (Get-Date).AddSeconds($Seconds)
$askedAdmin = $false
$others = @()

while ($true) {
  $ours = @(Ours)
  foreach ($p in $ours) { Stop-Process -Id $p.ProcessId -Force }
  if ($ours.Count) { Start-Sleep -Milliseconds 700 }
  $ours = @(Ours)

  # Не закрылись — значит, запущены от имени администратора. Один раз просим Windows закрыть их
  if ($ours.Count -and -not $askedAdmin) {
    $askedAdmin = $true
    $ids = ($ours | ForEach-Object { $_.ProcessId }) -join ','
    Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList "-NoProfile -Command Stop-Process -Id $ids -Force"
    Start-Sleep -Milliseconds 700
    $ours = @(Ours)
  }

  $others = @()
  if ($files.Count) {
    $others = @([Locks]::Who($files) | Where-Object { $self -notcontains [int]($_.Split('|')[0]) })
  }
  if (-not $ours.Count -and -not $others.Count) { exit 0 }
  if ((Get-Date) -gt $deadline) { break }
  Start-Sleep -Seconds 1
}

$names = @($ours | ForEach-Object { $_.Name }) + @($others | ForEach-Object { $_.Split('|', 2)[1] }) | Select-Object -Unique
if ($Report) { ($names -join ', ') | Out-File -LiteralPath $Report -Encoding Unicode -NoNewline }
exit 3
