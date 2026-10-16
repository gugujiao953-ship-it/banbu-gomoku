@echo off
rem Banbu gomoku dev-server watchdog: if 127.0.0.1:5173 is not listening, start vite detached.
rem Registered as scheduled task "BanbuGomokuDevWatchdog". Remove: schtasks /Delete /TN BanbuGomokuDevWatchdog /F
cd /d "D:\Projects\五子棋2"
powershell -NoProfile -Command "$c=New-Object Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1',5173); exit 0 } catch { exit 1 } finally { $c.Close() }" && exit /b 0
start "" /b cmd /c "npm run dev -- --host 127.0.0.1 > dev-server.log 2>&1"
exit /b 0
