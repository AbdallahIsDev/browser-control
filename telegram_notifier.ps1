<#
.SYNOPSIS
    Telegram Notifier for Hermes-Codex Interop.
    Sends formatted messages to Abdallah's Telegram.
.DESCRIPTION
    Called by supervisor.ps1 or standalone to report task status.
    Supports Hermes updates and Codex verdicts.
#>
param(
    [Parameter(Mandatory=$true)]
    [string]$MessageType,  # "task_started", "codex_verdict", "loop_complete", "error"
    
    [string]$TaskName = "",
    [string]$Iteration = "",
    [string]$Verdict = "",
    [string]$Summary = ""
)

# Configurable — set your bot token and chat ID here, or via environment variables
$BOT_TOKEN = $env:TELEGRAM_BOT_TOKEN
$CHAT_ID   = $env:TELEGRAM_CHAT_ID

if (-not $BOT_TOKEN -or -not $CHAT_ID) {
    # Fallback: call the Hermes gateway to send via the connected Telegram platform
    # This uses the wsl-side hermes send-message if available, or falls back to curl.
    Write-Host "[NOTIFIER] TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID not set."
    Write-Host "[NOTIFIER] To enable notifications, set these environment variables."
    Write-Host "[NOTIFIER] Message was: `n$MessageType | $TaskName | $Iteration | $Verdict"
    return
}

$API_URL = "https://api.telegram.org/bot$BOT_TOKEN/sendMessage"

function Build-Message {
    $msg = switch ($MessageType) {
        "task_started" {
@"
🚀 <b>Task Started</b>
📋 <b>Task:</b> $TaskName
⏱ <b>Time:</b> $(Get-Date -Format 'HH:mm')
"@
        }
        "codex_verdict" {
            $color = if ($Verdict -eq "PASS") { "✅" } else { "❌" }
@"
$color <b>Codex Review Complete</b>
📋 <b>Task:</b> $TaskName
🔁 <b>Iteration:</b> $Iteration
$\color <b>Verdict:</b> $Verdict

$Summary
"@
        }
        "loop_complete" {
            $emoji = if ($Verdict -eq "PASS") { "✅" } else { "⚠️" }
@"
$emoji <b>Session Complete</b>
📋 <b>Task:</b> $TaskName
🔁 <b>Iterations:</b> $Iteration
🏁 <b>Outcome:</b> $Verdict

$Summary
"@
        }
        "error" {
@"
🔴 <b>Supervisor Error</b>
📋 <b>Task:</b> $TaskName
🔁 <b>Iteration:</b> $Iteration
❌ <b>Error:</b> $Summary
"@
        }
        default {
@"
📨 <b>Notification</b>
$MessageType
$Summary
"@
        }
    }
    return $msg
}

function Send-Telegram {
    param([string]$Text)
    try {
        $body = @{
            chat_id = $CHAT_ID
            text = $Text
            parse_mode = "HTML"
        } | ConvertTo-Json

        $response = Invoke-RestMethod -Uri $API_URL -Method Post -Body $body -ContentType "application/json; charset=utf-8"
        if ($response.ok) {
            Write-Host "[NOTIFIER] Message sent to Telegram." -ForegroundColor Green
        }
    } catch {
        Write-Host "[NOTIFIER] Failed to send Telegram message: $_" -ForegroundColor Red
    }
}

$message = Build-Message
Send-Telegram $message