Set ws = CreateObject("WScript.Shell")
ws.Run "python """ & Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\")) & "app.py""", 0, False
