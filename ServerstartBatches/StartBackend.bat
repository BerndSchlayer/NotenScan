@echo off
REM ---------------------------------------
REM 1. Pfade & Environment-Variablen anpassen
REM ---------------------------------------
set "ANACONDA_PATH=D:\Develop\anaconda3"
set "ENV_NAME=base"

REM ---------------------------------------
REM 2. Conda-Umgebung aktivieren
REM ---------------------------------------
call "%ANACONDA_PATH%\condabin\conda.bat" activate %ENV_NAME%
if errorlevel 1 (
    echo FEHLER: Aktivierung der Umgebung "%ENV_NAME%" fehlgeschlagen.
    pause
    exit /b 1
)

REM ---------------------------------------
REM 3. Ins Projektverzeichnis wechseln
REM ---------------------------------------
cd ..\Backend

REM ---------------------------------------
REM 4. Backend mit Uvicorn starten
REM ---------------------------------------
echo Starte Backend: uvicorn main:app
poetry run uvicorn main:app --reload --reload-dir D:\GitHub_Projekte\SC_BaseBackend\src

REM ---------------------------------------
REM 5. Fenster offen halten (optional)
REM ---------------------------------------
pause