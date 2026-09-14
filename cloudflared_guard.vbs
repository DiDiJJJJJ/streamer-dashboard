Option Explicit

Dim fso, shell, rootDir, cfDir, cfExe, tlog, guardLog, maxRestarts, restartCount, sleepMs
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

rootDir = fso.GetParentFolderName(WScript.ScriptFullName)
cfDir = fso.BuildPath(rootDir, "streamer-dashboard\server\bin")
cfExe = fso.BuildPath(cfDir, "cloudflared.exe")
tlog = fso.BuildPath(rootDir, "streamer-dashboard\server\tunnel.log")
guardLog = fso.BuildPath(rootDir, "streamer-dashboard\server\cloudflared_guard.log")

sleepMs = 20000
maxRestarts = 1000

Sub LogLine(msg)
    On Error Resume Next
    Dim ts
    Set ts = fso.OpenTextFile(guardLog, 8, True)
    ts.WriteLine Now() & " " & msg
    ts.Close
End Sub

Function IsCfRunning()
    On Error Resume Next
    Dim wmi, procs, proc, found
    found = False
    Set wmi = GetObject("winmgmts:\\.\root\cimv2")
    Set procs = wmi.ExecQuery("SELECT Name FROM Win32_Process WHERE Name='cloudflared.exe'")
    For Each proc In procs
        found = True
        Exit For
    Next
    IsCfRunning = found
End Function

Sub ClearOldLog()
    On Error Resume Next
    If fso.FileExists(tlog) Then fso.DeleteFile tlog, True
End Sub

Sub StartCf()
    On Error Resume Next
    Dim cmd
    cmd = """" & cfExe & """ tunnel --url http://localhost:8787 --logfile """ & tlog & """ --loglevel info --edge-ip-version 4 --protocol http2 --no-autoupdate"
    shell.Run cmd, 0, False
    LogLine "started cloudflared"
End Sub

Sub KillCf()
    On Error Resume Next
    shell.Run "taskkill /f /im cloudflared.exe", 0, False
    WScript.Sleep 2000
End Sub

LogLine "guard started"

Do While restartCount < maxRestarts
    If Not fso.FileExists(cfExe) Then
        LogLine "cloudflared.exe not found: " & cfExe
        WScript.Sleep sleepMs
    ElseIf Not IsCfRunning() Then
        restartCount = restartCount + 1
        LogLine "cloudflared not running, restart #" & restartCount
        KillCf
        ClearOldLog
        StartCf
        WScript.Sleep sleepMs
    Else
        WScript.Sleep sleepMs
    End If
Loop

LogLine "guard reached max restarts, exit"
