param(
  [Parameter(Mandatory = $true)]
  [string]$Exe,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Args
)

$ErrorActionPreference = 'Stop'

Start-Process -FilePath $Exe -ArgumentList $Args -Verb RunAs | Out-Null

