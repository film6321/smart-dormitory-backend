param(
  [string]$BaseUrl = 'http://127.0.0.1:3000',
  [string]$AdminEmail = $env:QA_ADMIN_EMAIL,
  [string]$AdminPassword = $env:QA_ADMIN_PASSWORD,
  [int]$UserId = 99,
  [string]$ImagePath = '.\tests\fixtures\face.jpg',
  [string]$DeviceCode = 'CAMERA_01',
  [switch]$ReadEvents
)

$ErrorActionPreference = 'Stop'

function Invoke-JsonRequest {
  param(
    [string]$Method,
    [string]$Uri,
    [hashtable]$Headers = @{},
    [object]$Body
  )

  $params = @{
    Method = $Method
    Uri = $Uri
    Headers = $Headers
    ContentType = 'application/json'
  }

  if ($null -ne $Body) {
    $params.Body = ($Body | ConvertTo-Json -Depth 10)
  }

  return Invoke-RestMethod @params
}

if ([string]::IsNullOrWhiteSpace($AdminEmail) -or [string]::IsNullOrWhiteSpace($AdminPassword)) {
  throw 'Set QA_ADMIN_EMAIL and QA_ADMIN_PASSWORD, or pass -AdminEmail and -AdminPassword.'
}

if (-not (Test-Path -LiteralPath $ImagePath -PathType Leaf)) {
  throw "Image file not found: $ImagePath"
}

Write-Host "[1/6] Health check"
$health = Invoke-JsonRequest -Method Get -Uri "$BaseUrl/api/health"
Write-Host ($health | ConvertTo-Json -Depth 10)

Write-Host "[2/6] Admin login"
$login = Invoke-JsonRequest -Method Post -Uri "$BaseUrl/api/auth/login" -Body @{
  email = $AdminEmail
  password = $AdminPassword
}
$token = $login.data.token
if ([string]::IsNullOrWhiteSpace($token)) {
  throw 'Login succeeded without data.token.'
}
$authHeaders = @{ Authorization = "Bearer $token" }

Write-Host "[3/6] Register face photo for user $UserId"
$registerJson = & curl.exe --fail-with-body --silent --show-error -X POST "$BaseUrl/api/face-verification/register" `
  -H "Authorization: Bearer $token" `
  -F "userId=$UserId" `
  -F "file=@$ImagePath"
$register = $registerJson | ConvertFrom-Json
Write-Host ($register | ConvertTo-Json -Depth 10)

Write-Host "[4/6] Verify captured/uploaded image"
$verifyJson = & curl.exe --fail-with-body --silent --show-error -X POST "$BaseUrl/api/face-verification/verify-image" `
  -F "threshold=0.65" `
  -F "file=@$ImagePath"
$verify = $verifyJson | ConvertFrom-Json
Write-Host ($verify | ConvertTo-Json -Depth 10)

Write-Host "[5/6] Read monitor devices and scan history"
$devices = Invoke-JsonRequest -Method Get -Uri "$BaseUrl/api/face-verification/devices" -Headers $authHeaders
$history = Invoke-JsonRequest -Method Get -Uri "$BaseUrl/api/face-verification/scan-history" -Headers $authHeaders
Write-Host 'Devices:'
Write-Host ($devices | ConvertTo-Json -Depth 10)
Write-Host 'Scan history:'
Write-Host ($history | ConvertTo-Json -Depth 10)

Write-Host "[6/6] Send unlock then lock command for $DeviceCode"
$unlock = Invoke-JsonRequest -Method Post -Uri "$BaseUrl/api/face-verification/door-command" -Headers $authHeaders -Body @{
  device_code = $DeviceCode
  action = 'unlock'
  timestamp = (Get-Date).ToUniversalTime().ToString('o')
}
$lock = Invoke-JsonRequest -Method Post -Uri "$BaseUrl/api/face-verification/door-command" -Headers $authHeaders -Body @{
  device_code = $DeviceCode
  action = 'lock'
  timestamp = (Get-Date).ToUniversalTime().ToString('o')
}
Write-Host 'Unlock:'
Write-Host ($unlock | ConvertTo-Json -Depth 10)
Write-Host 'Lock:'
Write-Host ($lock | ConvertTo-Json -Depth 10)

if ($ReadEvents) {
  Write-Host 'Reading monitor SSE events for five seconds. Press Ctrl+C to stop earlier.'
  curl.exe --silent --show-error --no-buffer --max-time 5 "$BaseUrl/api/face-verification/events" -H "Authorization: Bearer $token"
}

Write-Host 'Flow completed. Check whether verify.data.matched is real biometric output or mock fallback.'
