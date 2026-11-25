@echo off
rem 安居乐寓采购 · 共享试用服务端（Windows 单机）
rem 只监听 127.0.0.1，由内网穿透客户端对外转发，不需要开放防火墙端口
cd /d "%~dp0.."
set AJLY_HOST=127.0.0.1
set AJLY_PORT=3010
if not defined AJLY_KEEP_DEMO set AJLY_KEEP_DEMO=0
echo 正在启动共享采购服务，保持本窗口开启...
node server\app.js
pause
