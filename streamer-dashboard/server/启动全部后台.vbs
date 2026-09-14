Set ws = CreateObject("WScript.Shell")
scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
ws.Run "cmd /c """ & scriptDir & "run_server.bat""", 0, False
ws.Run "cmd /c """ & scriptDir & "run_tunnel.bat""", 0, False
