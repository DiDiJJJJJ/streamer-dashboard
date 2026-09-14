#Requires -Version 5.1
<#
.SYNOPSIS
    停电重启后"网页打不开"一键诊断与修复脚本
.DESCRIPTION
    覆盖以下排查场景：
      1. 网络适配器是否正常启用
      2. DNS 解析是否可用
      3. 本机到网关及外网的连通性
      4. 系统代理 / 防火墙是否阻断浏览器联网
    并在检测到异常时自动尝试修复（刷新 DNS、重置 Winsock / TCP-IP、
    重启网络服务、重新获取 DHCP、重启网卡、关闭代理等）。
.NOTES
    需以管理员身份运行；本脚本会尝试自我提权（弹出 UAC）。
    用法：
      NetDiag-Repair.ps1            # 交互模式，每项修复前询问
      NetDiag-Repair.ps1 -Auto      # 发现异常直接修复，不逐项询问
      NetDiag-Repair.ps1 -NoReboot  # 重置后不提示重启
#>

param(
    [switch] $Auto,     # 跳过确认，直接修复
    [switch] $NoReboot  # 不提示重启（netsh reset 需重启才完全生效）
)

$ErrorActionPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

# ===================== 自我提权 =====================
function Test-Admin {
    $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $pr = New-Object System.Security.Principal.WindowsPrincipal($id)
    return $pr.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}
if (-not (Test-Admin)) {
    $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    if ($Auto)     { $argList += ' -Auto' }
    if ($NoReboot) { $argList += ' -NoReboot' }
    Start-Process PowerShell.exe -Verb RunAs -ArgumentList $argList
    return
}

# ===================== 报告工具 =====================
$Global:Report = @()
function Report {
    param(
        [Parameter(Mandatory)] [string] $Step,
        [Parameter(Mandatory)] [ValidateSet('OK','WARN','FAIL','INFO','FIX')] [string] $Status,
        [string] $Detail = '',
        [string] $Action = ''
    )
    $color = @{ OK='Green'; WARN='Yellow'; FAIL='Red'; INFO='Gray'; FIX='Cyan' }[$Status]
    $tag   = @{ OK='[正常]'; WARN='[警告]'; FAIL='[异常]'; INFO='[信息]'; FIX='[已修复]' }[$Status]
    Write-Host "$tag $Step" -ForegroundColor $color
    if ($Detail) { Write-Host "        $Detail" -ForegroundColor Gray }
    if ($Action) { Write-Host "        -> 操作: $Action" -ForegroundColor Cyan }
    $Global:Report += [PSCustomObject]@{ 项目 = $Step; 状态 = $Status; 详情 = $Detail; 操作 = $Action }
}

function Need-Repair {
    if ($Auto) { return $true }
    $r = Read-Host '    是否尝试自动修复？(Y/N)'
    return ($r -match '^[Yy]')
}

Clear-Host
Write-Host '========================================================' -ForegroundColor Cyan
Write-Host '   停电重启后 网页打不开 诊断与修复工具' -ForegroundColor Cyan
Write-Host "   时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
Write-Host '========================================================' -ForegroundColor Cyan
Write-Host ''

# ===================== 1. 网络适配器 =====================
Write-Host '【1/6】网络适配器状态' -ForegroundColor White
$adapters = Get-NetAdapter
$up   = $adapters | Where-Object { $_.Status -eq 'Up'    -and $_.InterfaceDescription -notmatch 'Loopback|Tunnel' }
$down = $adapters | Where-Object { $_.Status -eq 'Disabled' -and $_.InterfaceDescription -notmatch 'Loopback|Tap|VPN|Virtual|Hyper-V|vEthernet' }
if ($up.Count -eq 0) {
    Report '网络适配器' 'FAIL' '没有任何物理/无线适配器处于启用(Up)状态'
    if (Need-Repair) {
        foreach ($a in $down) {
            Enable-NetAdapter -Name $a.Name -Confirm:$false
            Report "启用适配器 $($a.Name)" 'FIX' '' '已执行 Enable-NetAdapter，稍后重测'
        }
        Start-Sleep -Seconds 4
        $up = (Get-NetAdapter) | Where-Object { $_.Status -eq 'Up' }
    }
} else {
    Report '网络适配器' 'OK' "已启用: $($up.Name -join ', ')"
}
if ($up.Count -gt 0 -and $down.Count -gt 0) {
    Report '被禁用的适配器' 'WARN' "发现已禁用: $($down.Name -join ', ')" '如非人为禁用可考虑启用'
}

# ===================== 2. IP / 网关 / DNS 配置 =====================
Write-Host ''
Write-Host '【2/6】IP / 网关 / DNS 配置' -ForegroundColor White
$ipOk = $false
foreach ($a in $up) {
    $cfg   = Get-NetIPConfiguration -InterfaceIndex $a.ifIndex -ErrorAction SilentlyContinue
    $addr  = ($cfg.IPv4Address | Where-Object { $_.IPAddress -ne '127.0.0.1' } | Select-Object -First 1).IPAddress
    $gw    = ($cfg.IPv4DefaultGateway | Select-Object -First 1).NextHop
    $dns   = (($cfg.DNSServer | Where-Object { $_.AddressFamily -eq 2 }).ServerAddresses) -join ', '
    if ($addr -and $gw) { $ipOk = $true }
    Report "接口 $($a.Name)" $(if ($addr) { 'OK' } else { 'WARN' }) "IP=$($addr); 网关=$($gw); DNS=$($dns)"
}
if (-not $ipOk) {
    Report 'IP 配置' 'FAIL' '未发现有效的 IPv4 地址与默认网关（可能 DHCP 未获取）'
    if (Need-Repair) {
        foreach ($a in $up) {
            ipconfig /release *> $null
            ipconfig /renew  *> $null
            Report "重新获取 DHCP ($($a.Name))" 'FIX' '' '已执行 ipconfig /release + /renew'
        }
        Start-Sleep -Seconds 5
    }
}

# ===================== 3. DNS 解析 =====================
Write-Host ''
Write-Host '【3/6】DNS 解析可用性' -ForegroundColor White
$dnsOk = $false
try {
    $r = Resolve-DnsName -Name 'www.baidu.com' -DnsOnly -ErrorAction Stop | Select-Object -First 1
    Report 'DNS 解析 www.baidu.com' 'OK' "解析到 $($r.IPAddress)"
    $dnsOk = $true
} catch {
    Report 'DNS 解析 www.baidu.com' 'FAIL' "解析失败: $($_.Exception.Message)"
}
if (-not $dnsOk) {
    if (Need-Repair) {
        ipconfig /flushdns    *> $null
        ipconfig /registerdns *> $null
        foreach ($a in $up) {
            Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ServerAddresses ('223.5.5.5','119.29.29.29') -ErrorAction SilentlyContinue
        }
        Report '刷新 DNS 缓存并切换公共 DNS' 'FIX' '' '已 flushdns，并将 DNS 临时设为 223.5.5.5 / 119.29.29.29'
        Start-Sleep -Seconds 3
    }
}

# ===================== 4. 网关与外网连通性 =====================
Write-Host ''
Write-Host '【4/6】连通性测试' -ForegroundColor White
$gwAddr = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Select-Object -First 1).NextHop
if ($gwAddr) {
    $gwPing = Test-Connection -ComputerName $gwAddr -Count 2 -Quiet
    Report "网关连通 ($gwAddr)" $(if ($gwPing) { 'OK' } else { 'FAIL' }) $(if ($gwPing) { 'ICMP 可达' } else { '无法 ping 通网关（部分路由器禁用 ping，可参考外网测试）' })
} else {
    Report '默认网关' 'FAIL' '未找到默认网关路由'
    $gwPing = $false
}
$extPing = Test-Connection -ComputerName '8.8.8.8' -Count 2 -Quiet
$tcpOk   = Test-NetConnection -ComputerName 'www.baidu.com' -Port 443 -WarningAction SilentlyContinue -InformationLevel Quiet
$webOk   = Test-Connection -ComputerName 'www.baidu.com' -Count 2 -Quiet
$extReachable = $extPing -or $tcpOk -or $webOk
Report '外网连通性' $(if ($extReachable) { 'OK' } else { 'FAIL' }) $(if ($extReachable) { '可访问外网(ICMP/TCP443/DNS 至少一项通)' } else { '无法访问外网' })
if (-not $extReachable) {
    if (Need-Repair) {
        foreach ($a in $up) {
            Disable-NetAdapter -Name $a.Name -Confirm:$false -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            Enable-NetAdapter -Name $a.Name -Confirm:$false -ErrorAction SilentlyContinue
            Report "重启网络适配器 $($a.Name)" 'FIX' '' '已禁用再启用'
        }
        Start-Sleep -Seconds 6
    }
}

# ===================== 5. 系统代理 =====================
Write-Host ''
Write-Host '【5/6】系统代理设置' -ForegroundColor White
$proxyReg = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$pe = Get-ItemProperty -Path $proxyReg -Name ProxyEnable -ErrorAction SilentlyContinue
if ($pe -and $pe.ProxyEnable -eq 1) {
    $ps = (Get-ItemProperty -Path $proxyReg -Name ProxyServer -ErrorAction SilentlyContinue).ProxyServer
    Report '系统代理' 'WARN' "检测到代理已启用: $ps (可能阻断浏览器直连)" '建议关闭后重试'
    if (Need-Repair) {
        Set-ItemProperty -Path $proxyReg -Name ProxyEnable -Value 0
        netsh winhttp reset proxy *> $null
        Report '关闭系统代理' 'FIX' '' '已禁用 IE/系统代理并重置 WinHTTP 代理'
    }
} else {
    Report '系统代理' 'OK' '未启用系统代理'
}
$wh = netsh winhttp show proxy 2>$null
if ($wh -match 'Proxy Server') {
    Report 'WinHTTP 代理' 'WARN' '存在 WinHTTP 代理配置' '将随修复一并 reset'
}

# ===================== 6. 防火墙 =====================
Write-Host ''
Write-Host '【6/6】防火墙状态' -ForegroundColor White
$profiles = Get-NetFirewallProfile -ErrorAction SilentlyContinue
foreach ($p in $profiles) {
    $state = if ($p.Enabled -eq 'True') { '开启' } else { '关闭' }
    Report "防火墙-$([string]$p.Name)" 'INFO' "状态: $state"
}
$browserPath = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' -Name '(Default)' -ErrorAction SilentlyContinue).'(Default)'
if (-not $browserPath) {
    $browserPath = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe' -Name '(Default)' -ErrorAction SilentlyContinue).'(Default)'
}
if ($browserPath -and (Test-Path $browserPath)) {
    try {
        $rule = Get-NetFirewallRule -DisplayName '允许浏览器联网(诊断脚本)' -ErrorAction SilentlyContinue
        if (-not $rule) {
            New-NetFirewallRule -DisplayName '允许浏览器联网(诊断脚本)' -Direction Outbound -Program $browserPath -Action Allow -Profile Any -ErrorAction SilentlyContinue | Out-Null
            Report '防火墙放行浏览器' 'FIX' '' "已添加允许 $($browserPath) 出站规则"
        }
    } catch {}
}

# ===================== 深度修复（netsh 重置） =====================
Write-Host ''
Write-Host '【深度修复】网络协议栈重置' -ForegroundColor Cyan
$failCount = ($Global:Report | Where-Object { $_.状态 -eq 'FAIL' }).Count
if ($failCount -gt 0) {
    if (Need-Repair) {
        Write-Host '    执行: netsh winsock reset ...' -ForegroundColor Gray
        netsh winsock reset *> $null
        Write-Host '    执行: netsh int ip reset ...' -ForegroundColor Gray
        netsh int ip reset *> $null
        Write-Host '    执行: 重启网络相关服务 ...' -ForegroundColor Gray
        foreach ($svc in @('Dnscache','NlaSvc','netprofm','WinHttpAutoProxySvc','lmhosts')) {
            try { Restart-Service -Name $svc -Force -ErrorAction SilentlyContinue } catch {}
        }
        Report 'Winsock / TCP-IP 重置' 'FIX' '' '已重置，需重启电脑后完全生效'
    } else {
        Report 'Winsock / TCP-IP 重置' 'INFO' '已跳过（用户未确认）'
    }
} else {
    Report '网络协议栈重置' 'INFO' '未检测到需重置的严重故障'
}

# ===================== 汇总 =====================
Write-Host ''
Write-Host '========================================================' -ForegroundColor Cyan
Write-Host '   诊断汇总' -ForegroundColor Cyan
Write-Host '========================================================' -ForegroundColor Cyan
$fails = ($Global:Report | Where-Object { $_.状态 -eq 'FAIL' }).Count
$fixed = ($Global:Report | Where-Object { $_.状态 -eq 'FIX'  }).Count
$warns = ($Global:Report | Where-Object { $_.状态 -eq 'WARN' }).Count
Write-Host "异常: $fails   已修复: $fixed   警告: $warns" -ForegroundColor White
if ($fails -eq 0) {
    Write-Host '结论: 网络诊断未发现阻断性问题，请尝试刷新浏览器(Ctrl+F5)或重启浏览器。' -ForegroundColor Green
} else {
    Write-Host "结论: 发现 $fails 项异常，已尝试修复 $fixed 项。" -ForegroundColor Yellow
    if (-not $NoReboot) {
        $r = Read-Host '    重置类修复需重启电脑才能完全生效，是否立即重启？(Y/N)'
        if ($r -match '^[Yy]') { Write-Host '    即将重启...' -ForegroundColor Cyan; Start-Sleep -Seconds 3; Restart-Computer -Force }
    }
}
Write-Host ''
Write-Host '按任意键退出...' -ForegroundColor Gray
[void][System.Console]::ReadKey($true)
