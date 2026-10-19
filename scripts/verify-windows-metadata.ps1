param([Parameter(Mandatory = $true)][string]$ExecutablePath)
$ErrorActionPreference = 'Stop'
$packageFile = Get-Item -LiteralPath $ExecutablePath
$signature = Get-AuthenticodeSignature -LiteralPath $packageFile.FullName
[pscustomobject]@{
  ProductName = $packageFile.VersionInfo.ProductName
  ProductVersion = $packageFile.VersionInfo.ProductVersion
  FileDescription = $packageFile.VersionInfo.FileDescription
  SignatureStatus = [string]$signature.Status
} | ConvertTo-Json -Compress
