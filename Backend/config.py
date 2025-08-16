import os
from dotenv import load_dotenv

load_dotenv()  # .env-Datei automatisch laden

# Poppler und Tesseract Pfade
POPLER_PATH = r"D:/Develop/poppler-24.08.0/Library/bin"
TESSERACT_CMD = r"D:/Develop/tesseract.exe"
TESSERACT_TESSDATA_DIR = r"D:/Develop/Tesseract-OCR/tessdata"

"""
App-spezifische Konfiguration für Notenscan.

Hinweis: Generische Settings (DB, JWT, CORS/Frontend) kommen zentral aus SC_BaseBackend
über get_settings() und werden nicht mehr hier dupliziert.
"""

STATIC_DIR = os.getenv("STATIC_DIR") or os.path.join(os.getcwd(), "static")
PAGES_DIR = os.path.join(STATIC_DIR, "pages")
VOICES_EXPORT_DIR = os.path.join(STATIC_DIR, "voices_export")
BOXES_STORAGE = os.path.join(STATIC_DIR, "boxes.json")

# CORS/Frontend, Datenbank und JWT: zentral über SC_BaseBackend.settings
# Beispiel in Modulen: from sc_base_backend import get_settings -> settings.frontend_url, settings.cors_origins,
# settings.database_url (bzw. POSTGRES_* Aliases) und settings.jwt_secret
