// src/pages/Dashboard.jsx
import React, { useState, useRef, lazy } from "react";
import PDFViewer from "../components/PDFViewer";
const LoadingOverlay = lazy(() =>
  import("@schlayer-consulting/sc-base-frontend").then((m) => ({ default: m.LoadingOverlay }))
);
const DataGrid = lazy(() =>
  import("@schlayer-consulting/sc-base-frontend").then((m) => ({ default: m.DataGrid }))
);
import { useTranslation } from "react-i18next";

// Server-URL aus .env lesen (Vite)
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "";
const API_BASE = `${SERVER_URL}/api/v1`;

interface VoiceScanPageProps {
  token: string;
  onRefresh: () => void;
}

interface VoiceResult {
  page: number;
  titleFound: string;
  voice: string;
  numPages?: number;
}

export default function VoiceScanPage({
  token,
  onRefresh,
}: VoiceScanPageProps) {
  const { t } = useTranslation("VoiceScanPage");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [status, setStatus] = useState<string | null>(null);
  const pdfViewerRef = useRef<any>(null);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [voices, setVoices] = useState<VoiceResult[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [pages, setPages] = useState<string[]>([]);

  // Automatisches Hochladen nach Dateiauswahl
  React.useEffect(() => {
    if (file) {
      handleUpload();
    }
    // eslint-disable-next-line
  }, [file]);

  // Polling für Task-Status und Seiten nach Upload
  React.useEffect(() => {
    if (!taskId) return;
    let interval: NodeJS.Timeout;
    let cancelled = false;
    const pollStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/pdf_tasks/status/${taskId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Status-Request fehlgeschlagen");
        const data = await res.json();
        if (data.status === "done") {
          // Seiten abrufen
          const pagesRes = await fetch(
            `${API_BASE}/pdf_tasks/pages/${taskId}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );
          if (pagesRes.ok) {
            const pagesData = await pagesRes.json();
            setPages(pagesData.pages);
            setStatus(t("upload_success", { num_pages: data.num_pages }));
            if (pdfViewerRef.current && pdfViewerRef.current.setPage) {
              pdfViewerRef.current.setPage(0);
            }
            if (interval) clearInterval(interval);
          }
        } else if (data.status === "error") {
          setStatus(
            t("upload_failed") +
              (data.error_message ? `: ${data.error_message}` : "")
          );
          if (interval) clearInterval(interval);
        } else {
          setStatus(t("upload_processing"));
        }
      } catch (err) {
        setStatus(t("upload_failed"));
        if (interval) clearInterval(interval);
      }
    };
    // Initial poll
    pollStatus();
    interval = setInterval(() => {
      if (!cancelled) pollStatus();
    }, 1500);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
    // eslint-disable-next-line
  }, [taskId]);

  const handleUpload = async (e?: React.FormEvent) => {
    setLoading(true);
    try {
      if (e) e.preventDefault();
      if (!file) return;
      setUploading(true);
      setStatus(null);

      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch(`${API_BASE}/pdf_tasks/upload`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });

        if (!res.ok) {
          setStatus(t("upload_failed"));
          setUploading(false);
          return;
        }
        const data = await res.json();
        if (data.task_id) {
          setTaskId(data.task_id);
          setStatus(t("upload_processing"));
          setPages([]); // Leere Seiten bis fertig
        } else {
          setStatus(t("upload_failed"));
        }
        onRefresh(); // Vorschau aktualisieren
      } catch (err) {
        setStatus(t("upload_failed"));
      } finally {
        setUploading(false);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleManualOCR = async (e: React.MouseEvent<HTMLButtonElement>) => {
    setLoading(true);
    try {
      e.preventDefault();
      if (pdfViewerRef.current && pdfViewerRef.current.recognizeText) {
        await pdfViewerRef.current.recognizeText();
      }
    } finally {
      setLoading(false);
    }
  };

  // Stimmen ermitteln (nutzt jetzt den Backend-Endpunkt /ocr/voices)
  const handleDetectVoices = async (e: React.MouseEvent<HTMLButtonElement>) => {
    setLoading(true);
    try {
      e.preventDefault();
      if (
        !pdfViewerRef.current ||
        !pdfViewerRef.current.getCurrentBoxesAndLabels
      ) {
        console.warn(
          "PDFViewer-Ref oder getCurrentBoxesAndLabels nicht verfügbar"
        );
        return;
      }
      const { boxes, labels } = pdfViewerRef.current.getCurrentBoxesAndLabels();
      if (!boxes || !labels) {
        console.warn("Keine Boxen oder Labels vorhanden");
        return;
      }
      if (!labels.Titel || !labels.Stimme) {
        alert(t("assign_title_voice"));
        return;
      }

      const titleBox = boxes.find((b: any) => b.text === labels.Titel);
      const voiceBox = boxes.find((b: any) => b.text === labels.Stimme);
      if (!titleBox || !voiceBox) {
        alert(t("assign_box_not_found"));
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/ocr/voices`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            title_box: {
              x: titleBox.x,
              y: titleBox.y,
              width: titleBox.width,
              height: titleBox.height,
            },
            voice_box: {
              x: voiceBox.x,
              y: voiceBox.y,
              width: voiceBox.width,
              height: voiceBox.height,
            },
          }),
        });
        if (!res.ok) {
          setStatus(t("detect_voices_failed"));
          return;
        }
        const data = await res.json();
        if (data.voices) {
          setVoices(
            data.voices.map((v: any, idx: number) => ({
              page: v.page,
              titleFound: v.title && v.title.trim() !== "" ? "Ja" : "Nein",
              voice: v.voice,
              numPages: v.num_pages,
            }))
          );
        }
      } catch (err) {
        setStatus(t("detect_voices_failed"));
      }
    } finally {
      setLoading(false);
    }
  };

  // Hilfsfunktion: Bildausschnitt OCR (muss Backend-API bereitstellen)
  async function cropAndOcr(
    img: any,
    x: number,
    y: number,
    w: number,
    h: number
  ): Promise<{ text: string; similarity: number }> {
    // Hier müsste ein Backend-Endpunkt angesprochen werden, der ein Bildstück OCR-t
    // Dummy-Implementierung:
    return { text: "Stimme", similarity: 1.0 };
  }

  // Stimmen-PDFs erzeugen
  const handleExportVoicesPDFs = async () => {
    if (!voices.length) return;
    setLoading(true);
    try {
      // Hole Metadaten aus Labels (so wie sie im PDFViewer zugewiesen sind)
      const { labels } = pdfViewerRef.current.getCurrentBoxesAndLabels
        ? pdfViewerRef.current.getCurrentBoxesAndLabels()
        : { labels: {} };
      const title = labels?.Titel || "";
      const genre = labels?.Genre || "";
      const komponist = labels?.Komponist || "";
      const arrangeur = labels?.Arrangeur || "";

      setStatus(t("export_pdfs_in_progress"));
      const res = await fetch(`${API_BASE}/ocr/voices/split`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          voices: voices.map((v) => ({ page: v.page, voice: v.voice })),
          title,
          genre,
          komponist,
          arrangeur,
        }),
      });
      if (!res.ok) {
        setStatus(t("export_pdfs_failed"));
        return;
      }
      const data = await res.json();
      if (data.status === "success") {
        setStatus(t("export_pdfs_success", { export_dir: data.export_dir }));
      } else {
        setStatus(t("export_pdfs_failed"));
      }
    } catch (err) {
      setStatus(t("export_pdfs_failed"));
    } finally {
      setLoading(false);
    }
  };

  // Neue Funktion: Alle Stimmen als ZIP herunterladen
  const handleExportVoicesZIP = async () => {
    if (!voices.length) return;
    setLoading(true);
    try {
      // Hole Metadaten aus Labels (so wie sie im PDFViewer zugewiesen sind)
      const { labels } = pdfViewerRef.current.getCurrentBoxesAndLabels
        ? pdfViewerRef.current.getCurrentBoxesAndLabels()
        : { labels: {} };
      const title = labels?.Titel || "";
      const genre = labels?.Genre || "";
      const komponist = labels?.Komponist || "";
      const arrangeur = labels?.Arrangeur || "";

      setStatus(t("export_zip_in_progress"));
      const res = await fetch(`${API_BASE}/ocr/voices/split_zip`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          voices: voices.map((v) => ({ page: v.page, voice: v.voice })),
          title,
          genre,
          komponist,
          arrangeur,
        }),
      });
      if (!res.ok) {
        setStatus(t("export_zip_failed"));
        return;
      }
      // Backend liefert: {zip_url: "..."}
      const data = await res.json();
      if (data.zip_url) {
        let downloadUrl = data.zip_url;
        if (downloadUrl.startsWith("/")) {
          downloadUrl = SERVER_URL + downloadUrl;
        }
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = "";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setStatus(t("export_zip_success"));
      } else {
        setStatus(t("export_zip_failed"));
      }
    } catch (err) {
      setStatus(t("export_zip_failed"));
    } finally {
      setLoading(false);
    }
  };

  // Einzelne Stimme als PDF erzeugen und im Download-Ordner bereitstellen
  const handleSaveVoice = async (voiceIdx: number) => {
    if (!voices.length) return;
    // Hole Metadaten aus Labels
    const { labels } = pdfViewerRef.current.getCurrentBoxesAndLabels
      ? pdfViewerRef.current.getCurrentBoxesAndLabels()
      : { labels: {} };
    const title = labels?.Titel || "";

    // Hole Startseite und Anzahl Seiten aus der Tabelle
    const current = voices[voiceIdx];
    const startPage = current.page;
    const numPages = current.numPages || 1; // Fallback: 1 Seite, falls nicht gesetzt
    const endPage = startPage + numPages - 1;
    const voiceText = current.voice;

    // Sende Request an Backend-Endpunkt für Einzelstimme (nur die Seiten dieser Stimme)
    try {
      const res = await fetch(`${API_BASE}/ocr/voices/split`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          voices: [{ page: startPage, voice: voiceText }],
          // Übergebe optional auch endPage, falls Backend dies unterstützt:
          start_page: startPage,
          end_page: endPage,
          title,
          genre: labels?.Genre || "",
          komponist: labels?.Komponist || "",
          arrangeur: labels?.Arrangeur || "",
        }),
      });
      if (!res.ok) {
        setStatus(t("save_voice_failed"));
        return;
      }
      const data = await res.json();
      if (
        data.status === "success" &&
        data.pdf_files &&
        data.pdf_files.length > 0
      ) {
        // Download-Link erzeugen und im neuen Tab öffnen:
        const filename = data.pdf_files[0];
        const downloadUrl = `${SERVER_URL}/static/voices_export/${encodeURIComponent(
          filename
        )}`;
        window.open(downloadUrl, "_blank"); // Im neuen Tab öffnen
        setStatus(t("save_voice_success", { voice: voiceText }));
      } else {
        setStatus(t("save_voice_failed"));
      }
    } catch (err) {
      setStatus(t("save_voice_failed"));
    }
  };

  // Drag & Drop Handler
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFile(e.dataTransfer.files[0]);
      // handleUpload() wird automatisch durch useEffect ausgeführt
    }
  };

  const handleFileInputClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      // handleUpload() wird automatisch durch useEffect ausgeführt
    }
  };

  // Spalten für DataGrid der Stimmen
  const voicesColumns = [
    { key: "page", label: t("voices_column_page") },
    {
      key: "numPages",
      label: t("voices_column_numPages"),
      width: 80,
      minWidth: 60,
      maxWidth: 100,
    },
    { key: "titleFound", label: t("voices_column_titleFound") },
    {
      key: "voice",
      label: t("voices_column_voice"),
      render: (val: string, row: VoiceResult) => (
        <button
          type="button"
          className="text-blue-600 underline hover:text-blue-800 focus:outline-none"
          onClick={() => {
            if (pdfViewerRef.current) {
              pdfViewerRef.current.setPage &&
                pdfViewerRef.current.setPage(row.page - 1);
            }
          }}
        >
          {val}
        </button>
      ),
    },
    {
      key: "__actions",
      label: t("voices_column_actions"),
      style: { width: 120, minWidth: 100, maxWidth: 140 },
    },
  ];

  return (
    <div className="flex h-screen">
      <LoadingOverlay show={loading} />
      <div className="w-2/3 bg-white border-r overflow-hidden">
        <PDFViewer token={token} ref={pdfViewerRef} pages={pages} />
      </div>
      <div className="w-1/3 p-6 overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">{t("upload_title")}</h2>
        {/* Drag & Drop Bereich mit integriertem Datei-Auswahl-Link */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`w-full mb-4 p-6 border-2 border-dashed rounded transition-colors duration-200
            ${
              dragActive
                ? "border-blue-500 bg-blue-50"
                : "border-gray-300 bg-gray-100"
            }
          `}
        >
          <p className="text-center text-gray-500">
            {t("drag_drop_text")}{" "}
            <button
              type="button"
              onClick={handleFileInputClick}
              className="text-blue-600 underline hover:text-blue-800 focus:outline-none"
              tabIndex={0}
            >
              {t("select_file")}
            </button>
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
        </div>
        {/* Aktionen Label */}
        <h2 className="text-lg font-semibold mb-2">{t("actions_title")}</h2>
        <form className="space-y-4">
          <div className="flex gap-4">
            {/* Hochladen-Button entfernt */}
            <button
              type="button"
              className="bg-amber-600 text-white px-4 py-2 rounded hover:bg-amber-700"
              onClick={handleManualOCR}
              disabled={uploading}
            >
              {t("ocr_button")}
            </button>
            <button
              type="button"
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
              onClick={handleDetectVoices}
              disabled={uploading}
            >
              {t("detect_voices_button")}
            </button>
          </div>
        </form>
        {file && (
          <div className="mt-2 text-sm text-gray-700">
            {t("selected_file")}{" "}
            <span className="font-semibold">{file.name}</span>
          </div>
        )}
        {status && <p className="mt-2 text-sm">{status}</p>}
        {/* Stimmen-Tabelle */}
        {voices.length > 0 && (
          <div className="mt-6">
            <h2 className="text-lg font-semibold mb-2">
              {t("voices_table_title")}
            </h2>
            <DataGrid
              columns={voicesColumns}
              data={voices}
              idField="page"
              pageSize={20}
              actionsColStyle={{
                width: "120px",
                minWidth: "100px",
                maxWidth: "140px",
              }}
            />
            {/* Neue Schaltfläche unterhalb der Tabelle */}
            <div className="mt-4 flex justify-start gap-2">
              <button
                type="button"
                className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700"
                onClick={handleExportVoicesPDFs}
              >
                {t("export_pdfs_button")}
              </button>
              <button
                type="button"
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                onClick={handleExportVoicesZIP}
              >
                {t("export_zip_button")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
