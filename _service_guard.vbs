' Streamer dashboard service guard
' ASCII only: never put non-ascii chars in this file (vbscript reads it as ANSI)
' Features: self path detect, single instance, port aware, fast-fail backoff
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
root = scriptDir & "\streamer-dashboard"
node = "C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
logFile = root & "\server\server_run.log"
port = "8787"

selftest = False
If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "/selftest" Then selftest = True
End If

If Not fso.FileExists(node) Then
  LogLine "FATAL node.exe not found: " & node
  WScript.Quit 1
End If
If Not fso.FileExists(root & "\server\index.js") Then
  LogLine "FATAL server/index.js not found under: " & root
  WScript.Quit 1
End If

WshShell.CurrentDirectory = root
WshShell.Environment("Process")("NODE_OPTIONS") = ""

If selftest Then
  WScript.Echo "scriptDir=" & scriptDir
  WScript.Echo "root=" & root
  WScript.Echo "node=" & node
  WScript.Echo "node_exists=" & fso.FileExists(node)
  WScript.Echo "index_exists=" & fso.FileExists(root & "\server\index.js")
  WScript.Echo "port_busy=" & PortBusy()
  WScript.Echo "guard_instances=" & GuardInstances()
  LogLine "selftest ok"
  WScript.Echo "SELFTEST OK"
  WScript.Quit 0
End If

If GuardInstances() > 1 Then
  LogLine "another guard instance is already running, exit"
  WScript.Quit 0
End If

LogLine "guard started"
failCount = 0
Do
  If PortBusy() Then
    failCount = 0
  Else
    LogLine "starting node server"
    t0 = Timer
    rc = WshShell.Run("""" & node & """ server\index.js", 0, True)
    dt = Timer - t0
    If dt < 0 Then dt = dt + 86400
    If dt < 10 Then
      failCount = failCount + 1
      LogLine "server exited fast (rc=" & rc & ", " & CInt(dt) & "s), failCount=" & failCount
    Else
      failCount = 0
      LogLine "server exited (rc=" & rc & "), restarting"
    End If
  End If
  If failCount >= 5 Then
    WScript.Sleep 60000
  Else
    WScript.Sleep 5000
  End If
Loop

Sub LogLine(msg)
  Dim f
  On Error Resume Next
  Err.Clear
  Set f = fso.OpenTextFile(logFile, 8, True)
  If Err.Number = 0 Then
    f.WriteLine "[guard] " & Now & " " & msg
    f.Close
  End If
  On Error GoTo 0
End Sub

Function PortBusy()
  Dim oExec, out, n
  PortBusy = False
  On Error Resume Next
  Err.Clear
  Set oExec = WshShell.Exec("cmd /c netstat -ano | findstr "":" & port & """ | findstr LISTENING")
  If Err.Number <> 0 Then
    On Error GoTo 0
    Exit Function
  End If
  n = 0
  Do While oExec.Status = 0 And n < 50
    WScript.Sleep 100
    n = n + 1
  Loop
  out = ""
  Do While Not oExec.StdOut.AtEndOfStream
    out = out & oExec.StdOut.ReadLine() & " "
  Loop
  On Error GoTo 0
  If Len(Trim(out)) > 0 Then PortBusy = True
End Function

Function GuardInstances()
  Dim wmi, col, p, n
  GuardInstances = 1
  On Error Resume Next
  Err.Clear
  Set wmi = GetObject("winmgmts:\\.\root\cimv2")
  If Err.Number <> 0 Then
    On Error GoTo 0
    Exit Function
  End If
  n = 0
  Set col = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE (Name='wscript.exe' OR Name='cscript.exe') AND CommandLine LIKE '%_service_guard.vbs%'")
  If Err.Number = 0 Then
    For Each p In col
      n = n + 1
    Next
  End If
  On Error GoTo 0
  GuardInstances = n
End Function
