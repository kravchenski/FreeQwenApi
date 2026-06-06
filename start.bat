@echo off
chcp 65001 >nul
title Запуск Qwen API сервера

echo Проверка наличия Bun...
where bun >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ОШИБКА] Bun не установлен!
    echo Установите Bun с сайта https://bun.sh/
    pause
    exit /b 1
)

echo Установка зависимостей...
call bun install

if %ERRORLEVEL% neq 0 (
    echo [ОШИБКА] Не удалось установить зависимости!
    pause
    exit /b 1
)

echo.
echo Запуск приложения...
echo.

bun run index.js

pause
