@echo off
rem 安居乐寓采购 · 共享试用服务端（Windows 单机）
rem 监听所有网卡；局域网可直接访问，穿透客户端仍走本机 3012
cd /d "%~dp0.."
set AJLY_HOST=0.0.0.0
set AJLY_PORT=3012
if not defined AJLY_KEEP_DEMO set AJLY_KEEP_DEMO=0
echo 正在启动共享采购服务，保持本窗口开启...
node server\app.js
pause
