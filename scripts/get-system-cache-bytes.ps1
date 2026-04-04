$ErrorActionPreference = 'Stop'

$sig = @'
using System;
using System.Runtime.InteropServices;
public static class PsApi {
  [StructLayout(LayoutKind.Sequential)]
  public struct PERFORMANCE_INFORMATION {
    public uint cb;
    public UIntPtr CommitTotal;
    public UIntPtr CommitLimit;
    public UIntPtr CommitPeak;
    public UIntPtr PhysicalTotal;
    public UIntPtr PhysicalAvailable;
    public UIntPtr SystemCache;
    public UIntPtr KernelTotal;
    public UIntPtr KernelPaged;
    public UIntPtr KernelNonpaged;
    public UIntPtr PageSize;
    public uint HandleCount;
    public uint ProcessCount;
    public uint ThreadCount;
  }

  [DllImport("psapi.dll", SetLastError=true)]
  public static extern bool GetPerformanceInfo(out PERFORMANCE_INFORMATION p, uint cb);
}
'@

Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue | Out-Null

$pi = New-Object PsApi+PERFORMANCE_INFORMATION
$pi.cb = [System.Runtime.InteropServices.Marshal]::SizeOf($pi)

$ok = [PsApi]::GetPerformanceInfo([ref]$pi, $pi.cb)
$page = [UInt64]$pi.PageSize
$cache = [UInt64]$pi.SystemCache

[pscustomobject]@{
  ok        = $ok
  cacheBytes = [UInt64]($cache * $page)
} | ConvertTo-Json -Compress

