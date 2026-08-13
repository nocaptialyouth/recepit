@echo off
chcp 65001 > nul
echo ===================================================
echo 🐙 GitHub Auto Sync (nocaptialyouth/recepit)
echo ===================================================
cd /d "c:\Users\user\Desktop\가계"
git add .
git commit -m "Auto sync household ledger data: %date% %time%"
git push origin main
echo ===================================================
echo ✅ GitHub 동기화 완료! (https://github.com/nocaptialyouth/recepit)
echo ===================================================
