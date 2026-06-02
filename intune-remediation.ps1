param(
  [string]$ApiUrl = 'https://your-domain/api/monitoring/telemetry',
  [string]$ApiKey = 'replace-with-strong-key',
  [string]$RegistryPath = 'HKLM:\SOFTWARE\ITSMMonitoringAgent'
)

$ErrorActionPreference = 'Stop'

function Ensure-StatePath {
  param([string]$Path)

  if (-not (Test-Path -Path $Path)) {
    New-Item -Path $Path -Force | Out-Null
  }
}

function Write-State {
  param(
    [string]$Status,
    [string]$ErrorMessage = ''
  )

  Ensure-StatePath -Path $RegistryPath

  Set-ItemProperty -Path $RegistryPath -Name 'LastRunUtc' -Value ((Get-Date).ToUniversalTime().ToString('o')) -Force
  Set-ItemProperty -Path $RegistryPath -Name 'LastStatus' -Value $Status -Force

  if ($Status -eq 'Success') {
    Set-ItemProperty -Path $RegistryPath -Name 'LastSuccessUtc' -Value ((Get-Date).ToUniversalTime().ToString('o')) -Force
    Set-ItemProperty -Path $RegistryPath -Name 'LastError' -Value '' -Force
  } else {
    Set-ItemProperty -Path $RegistryPath -Name 'LastError' -Value $ErrorMessage -Force
  }
}

function Get-ScreenStatus {
  try {
    $monitors = Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorBasicDisplayParams
    return ($null -ne $monitors -and $monitors.Count -gt 0)
  } catch {
    return $true
  }
}

function Get-ScreenOnDuration {
  try {
    $os = Get-CimInstance Win32_OperatingSystem
    $uptime = (Get-Date) - $os.ConvertToDateTime($os.LastBootUpTime)
    return [math]::Round($uptime.TotalSeconds)
  } catch {
    return 0
  }
}

function Get-ActiveApplications {
  try {
    $windowApps = Get-Process |
      Where-Object { $_.MainWindowTitle -and $_.Name } |
      Select-Object -ExpandProperty Name -Unique

    $allProcesses = Get-Process | Select-Object -ExpandProperty Name -Unique

    return @{
      active_apps = @($windowApps)
      all_processes = @($allProcesses)
    }
  } catch {
    return @{
      active_apps = @()
      all_processes = @()
    }
  }
}

function Get-LoggedInUser {
  try {
    $computerSystem = Get-CimInstance Win32_ComputerSystem
    if ($computerSystem.UserName) {
      return $computerSystem.UserName
    }

    $explorer = Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" | Select-Object -First 1
    if ($explorer) {
      $owner = Invoke-CimMethod -InputObject $explorer -MethodName GetOwner
      if ($owner.Domain -and $owner.User) {
        return "$($owner.Domain)\$($owner.User)"
      }
    }

    return $env:USERNAME
  } catch {
    return $env:USERNAME
  }
}

function Get-CPUUsage {
  try {
    $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
    return [math]::Round([double]$cpu, 2)
  } catch {
    return 0
  }
}

function Get-MemoryUsage {
  try {
    $os = Get-CimInstance Win32_OperatingSystem
    $used = $os.TotalVisibleMemorySize - $os.FreePhysicalMemory
    $percent = ($used / $os.TotalVisibleMemorySize) * 100
    return [math]::Round([double]$percent, 2)
  } catch {
    return 0
  }
}

function Get-DiskUsage {
  try {
    $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
    if (-not $disk.Size) {
      return 0
    }

    $used = (($disk.Size - $disk.FreeSpace) / $disk.Size) * 100
    return [math]::Round([double]$used, 2)
  } catch {
    return 0
  }
}

function Get-OSDetails {
  try {
    $os = Get-CimInstance Win32_OperatingSystem
    return @{
      os_name = $os.Caption
      os_version = $os.Version
      os_build = $os.BuildNumber
    }
  } catch {
    return @{
      os_name = 'unknown'
      os_version = 'unknown'
      os_build = 'unknown'
    }
  }
}

function Get-NetworkInfo {
  try {
    $ip = Get-NetIPAddress -AddressFamily IPv4 |
      Where-Object { $_.InterfaceAlias -notlike '*Loopback*' -and $_.IPAddress -notlike '169.254*' } |
      Select-Object -First 1 -ExpandProperty IPAddress

    if ($ip) {
      return $ip
    }

    return 'unknown'
  } catch {
    return 'unknown'
  }
}

if ([string]::IsNullOrWhiteSpace($ApiUrl) -or [string]::IsNullOrWhiteSpace($ApiKey)) {
  Write-State -Status 'Failed' -ErrorMessage 'ApiUrl or ApiKey is missing.'
  Write-Output 'ApiUrl or ApiKey is not configured.'
  exit 1
}

$hostname = $env:COMPUTERNAME
$apps = Get-ActiveApplications
$osDetails = Get-OSDetails

$payload = @{
  device_id = $hostname
  hostname = $hostname
  user_name = Get-LoggedInUser
  user_email = ''
  ip_address = Get-NetworkInfo
  os_name = $osDetails.os_name
  os_version = $osDetails.os_version
  os_build = $osDetails.os_build
  screen_on = Get-ScreenStatus
  screen_on_duration = Get-ScreenOnDuration
  active_apps = $apps.active_apps
  all_processes = $apps.all_processes
  cpu_percent = Get-CPUUsage
  memory_percent = Get-MemoryUsage
  disk_percent = Get-DiskUsage
  reported_at = (Get-Date).ToUniversalTime().ToString('o')
}

$headers = @{
  'Content-Type' = 'application/json'
  'x-monitoring-key' = $ApiKey
}

try {
  $body = $payload | ConvertTo-Json -Depth 6
  Invoke-RestMethod -Uri $ApiUrl -Method Post -Headers $headers -Body $body -TimeoutSec 15 | Out-Null
  Write-State -Status 'Success'
  Write-Output 'Telemetry posted successfully.'
  exit 0
} catch {
  $message = $_.Exception.Message
  Write-State -Status 'Failed' -ErrorMessage $message
  Write-Output ("Telemetry post failed: {0}" -f $message)
  exit 1
}
