@echo off
REM ---------------------------------------
REM 1. Ins Projektverzeichnis wechseln
REM ---------------------------------------
cd ..\Backend

REM ---------------------------------------
REM 2. Backend mit Poetry und Uvicorn starten
REM ---------------------------------------
echo Starte Backend: uvicorn main:app
poetry run uvicorn main:app --reload --reload-dir D:\GitHub_Projekte\SC_BaseBackend\src

REM ---------------------------------------
REM 3. Fenster offen halten (optional)
REM ---------------------------------------
pause