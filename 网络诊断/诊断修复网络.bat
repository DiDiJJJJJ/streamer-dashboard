@echo off
chcp 65001 >nul 2>&1
PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0NetDiag-Repair.ps1"
