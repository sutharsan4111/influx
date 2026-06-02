param(
  [int]$MaxAgeMinutes = 20,
  [string]$RegistryPath = 'HKLM:\SOFTWARE\ITSMMonitoringAgent'
)

$ErrorActionPreference = 'Stop'

try {
  if (-not (Test-Path -Path $RegistryPath)) {
    Write-Output 'Monitoring registry path not found.'
    exit 1
  }

  $state = Get-ItemProperty -Path $RegistryPath -ErrorAction Stop
  $lastSuccessUtc = $state.LastSuccessUtc

  if (-not $lastSuccessUtc) {
    Write-Output 'LastSuccessUtc is missing.'
    exit 1
  }

  $lastRun = [datetime]::Parse($lastSuccessUtc).ToUniversalTime()
  $ageMinutes = ((Get-Date).ToUniversalTime() - $lastRun).TotalMinutes

  if ($ageMinutes -le $MaxAgeMinutes) {
    Write-Output ("Healthy. Last success {0:N1} minutes ago." -f $ageMinutes)
    exit 0
  }

  Write-Output ("Stale. Last success {0:N1} minutes ago." -f $ageMinutes)
  exit 1
} catch {
  Write-Output ("Detection failed: {0}" -f $_.Exception.Message)
  exit 1
}
