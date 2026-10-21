$ErrorActionPreference = 'Stop'

$stage = 'local-projects/ai-vercel-stage'
$meta = Get-Content -LiteralPath "$stage/.vercel/project.json" -Raw | ConvertFrom-Json
if ($meta.projectId -ne 'prj_cmlvPMIbvku9p2qZvlaT5kVMgIeW' -or
    $meta.orgId -ne 'team_N6SkpQIfjyLBsl9L4wsAfXUS') {
  throw 'The isolated stage is not linked to the expected Vercel project.'
}

$pin = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
$bypass = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(16))
$apiUrl = "https://api.vercel.com/v1/projects/$($meta.projectId)/protection-bypass?teamId=$($meta.orgId)"
$created = $false
$revoked = $false
$testCode = 1
$phase = 'deployment'

try {
  $deploymentText = (& vercel deploy --cwd $stage --prod --skip-domain --yes --scope tb2 --no-color -e "BRIEF_PIN=$pin" 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) {
    Write-Output $deploymentText.Replace($pin, '[redacted]')
    throw 'The isolated deployment did not build.'
  }
  $deploymentMatch = [regex]::Matches($deploymentText, 'https://[A-Za-z0-9.-]+\.vercel\.app') | Select-Object -Last 1
  if (-not $deploymentMatch) { throw 'Vercel did not return the isolated deployment URL.' }
  $url = $deploymentMatch.Value
  Write-Output "Isolated deployment: $url"

  $phase = 'temporary bypass creation'
  $auth = Get-Content -LiteralPath 'C:/Users/q/AppData/Roaming/com.vercel.cli/Data/auth.json' -Raw | ConvertFrom-Json
  $headers = @{ Authorization = "Bearer $($auth.token)" }
  $generate = @{ generate = @{ secret = $bypass; note = 'Temporary home AI floorplan verification' } } | ConvertTo-Json -Depth 4 -Compress
  $null = Invoke-RestMethod -Uri $apiUrl -Method Patch -Headers $headers -ContentType 'application/json' -Body $generate
  $created = $true
  Write-Output 'Temporary automation bypass created.'

  $phase = 'protected page check'
  $probe = Invoke-WebRequest -Uri "$url/home.html" -Headers @{ 'x-vercel-protection-bypass' = $bypass } -UseBasicParsing
  if (-not $probe.Content.Contains('id="importFile"')) { throw 'The temporary bypass did not expose the isolated home page.' }

  $phase = 'live floorplan reading'
  $env:HOME_AI_URL = $url
  $env:HOME_AI_PIN = $pin
  $env:HOME_AI_BYPASS = $bypass
  $env:NODE_PATH = 'C:\Users\q\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
  node scripts/verify-home-ai-live.cjs
  $testCode = $LASTEXITCODE
} catch {
  $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
  Write-Output "Verification stopped during $phase ($($_.Exception.GetType().Name), HTTP $status)."
} finally {
  Remove-Item Env:HOME_AI_URL,Env:HOME_AI_PIN,Env:HOME_AI_BYPASS -ErrorAction SilentlyContinue
  if ($created) {
    $phase = 'temporary bypass revocation'
    $revoke = @{ revoke = @{ secret = $bypass; regenerate = $false } } | ConvertTo-Json -Depth 4 -Compress
    for ($attempt = 1; $attempt -le 3 -and -not $revoked; $attempt++) {
      try {
        $null = Invoke-RestMethod -Uri $apiUrl -Method Patch -Headers $headers -ContentType 'application/json' -Body $revoke
        $revoked = $true
      } catch {
        if ($attempt -lt 3) { Start-Sleep -Seconds 2 }
      }
    }
    if ($revoked) {
      $accessDenied = $false
      for ($attempt = 1; $attempt -le 3 -and -not $accessDenied; $attempt++) {
        try {
          $checkUrl = "$url/home.html?revocationCheck=$attempt"
          $check = Invoke-WebRequest -Uri $checkUrl -Headers @{ 'x-vercel-protection-bypass' = $bypass } -UseBasicParsing
          $accessDenied = -not $check.Content.Contains('id="importFile"')
        } catch {
          $status = [int]$_.Exception.Response.StatusCode
          $accessDenied = $status -eq 401 -or $status -eq 403
        }
        if (-not $accessDenied -and $attempt -lt 3) { Start-Sleep -Seconds 2 }
      }
      Write-Output $(if ($accessDenied) { 'Temporary automation bypass revoked; protected page is inaccessible with that secret.' } else { 'WARNING: Vercel accepted revocation, but access denial was not confirmed.' })
      if (-not $accessDenied) { $revoked = $false }
    } else {
      Write-Output 'WARNING: Temporary automation bypass revocation was not confirmed.'
    }
  }
}

if ($created -and -not $revoked) { exit 2 }
if ($testCode -ne 0) { exit 1 }
exit 0
