import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import deCommon from "./locales/de/common.json";
import deAppShell from "./locales/de/AppShell.json";
import deVoiceScanPage from "./locales/de/VoiceScanPage.json";
import dePDFViewer from "./locales/de/PDFViewer.json";
import deDocumentUploadPage from "./locales/de/DocumentUploadPage.json";

import enCommon from "./locales/en/common.json";
import enAppShell from "./locales/en/AppShell.json";
import enVoiceScanPage from "./locales/en/VoiceScanPage.json";
import enPDFViewer from "./locales/en/PDFViewer.json";
import enDocumentUploadPage from "./locales/en/DocumentUploadPage.json";

import frCommon from "./locales/fr/common.json";
import frAppShell from "./locales/fr/AppShell.json";
import frVoiceScanPage from "./locales/fr/VoiceScanPage.json";
import frPDFViewer from "./locales/fr/PDFViewer.json";
import frDocumentUploadPage from "./locales/fr/DocumentUploadPage.json";
// Registriert Übersetzungen aus der geteilten UI-Bibliothek (z.B. DateInput)

// Typdefinition für das Ressourcen-Objekt
interface Resource {
  [key: string]: any;
}

const resources: { [lang: string]: Resource } = {
  de: {
    common: deCommon,
    AppShell: deAppShell,
    VoiceScanPage: deVoiceScanPage,
    PDFViewer: dePDFViewer,
    DocumentUploadPage: deDocumentUploadPage,
  },
  en: {
    common: enCommon,
    AppShell: enAppShell,
    VoiceScanPage: enVoiceScanPage,
    PDFViewer: enPDFViewer,
    DocumentUploadPage: enDocumentUploadPage,
  },
  fr: {
    common: frCommon,
    AppShell: frAppShell,
    VoiceScanPage: frVoiceScanPage,
    PDFViewer: frPDFViewer,
    DocumentUploadPage: frDocumentUploadPage,
  },
};

// Sprache aus LocalStorage beim Start setzen
const storedLang = localStorage.getItem("app_language");
const browserLang = navigator.language?.slice(0, 2);
const initialLang =
  storedLang || (["de", "en", "fr"].includes(browserLang) ? browserLang : "de");

i18n.use(initReactI18next).init({
  resources,
  lng: initialLang,
  fallbackLng: "en",
  ns: [
    "user",
    "UserSettingsDialog",
    "common",
    "AppShell",
    "LoginPage",
    "OrganisationsPage",
    "VoiceScanPage",
    "UserMenu",
    "PDFViewer",
    "DocumentUploadPage",
    "FloatingDateInput", // Namespace der Library
    "FloatingTagInput",
    "FloatingLookupSelect",
    "LoadingOverlay",
    "LanguageSwitcher",
    "DataGrid",
    "MasterDataTemplate",
  ],
  defaultNS: "user",
  interpolation: { escapeValue: false },
});

// Library-Übersetzungen registrieren (FloatingDateInput-namespace) NACH init,
// damit init den Resource-Store nicht überschreibt
// Dynamisch die i18n-Registrierung aus der shared UI-Bibliothek laden,
// damit diese Bibliothek nicht statisch in den Main-Chunk wandert.
import("@schlayer-consulting/sc-base-frontend")
  .then((m) => {
    if (m && typeof m.registerSCBaseFrontendI18n === "function") {
      m.registerSCBaseFrontendI18n();
      // sicherstellen, dass die wichtigen Namespaces geladen sind
      i18n.loadNamespaces("FloatingDateInput");
      i18n.loadNamespaces("FloatingTagInput");
      i18n.loadNamespaces("FloatingLookupSelect");
      i18n.loadNamespaces("LoadingOverlay");
      i18n.loadNamespaces("LanguageSwitcher");
      i18n.loadNamespaces("DataGrid");
      i18n.loadNamespaces("MasterDataTemplate");
    }
  })
  .catch(() => {
    // Fallback: falls die Library nicht verfügbar ist, ignorieren
  });

export default i18n;
