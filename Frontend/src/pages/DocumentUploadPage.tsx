import { ScanText, ChevronLeft, ChevronRight } from "lucide-react";
import React, { useEffect, useState, useRef, Suspense, lazy } from "react";
import { useNavigate } from "react-router-dom";
const PDFViewer = lazy(() => import("../components/PDFViewer"));
const OcrLabelAssignment = lazy(
  () => import("../components/OcrLabelAssignment")
);
import toast from "react-hot-toast";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MasterDataTemplate } from "@schlayer-consulting/sc-base-frontend";

// Typen für OCR-Boxen und Labels
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}
type LabelKeys = "Titel" | "Komponist" | "Arrangeur" | "Stimme" | "Genre";
type Labels = Partial<Record<LabelKeys, number>>;

interface DocumentDetailCardProps {
  row: any;
  token: string;
  t: any;
}

export interface DocumentDetailCardHandle {
  recognizeText: () => Promise<boolean>;
}

interface DocumentDetailCardExtendedProps extends DocumentDetailCardProps {
  currentPage: number;
  onPageChange: (pageIdx: number) => void;
  onBoxChange?: (boxes: Box[], isNotFound?: boolean) => void;
}

const DocumentDetailCard = React.forwardRef<
  DocumentDetailCardHandle,
  DocumentDetailCardExtendedProps
>(({ row, token, t, currentPage, onPageChange, onBoxChange }, ref) => {
  // State for PDF pages, navigation, boxes, labels, loading, error
  const [pages, setPages] = React.useState<string[]>([]);
  const [boxes, setBoxes] = React.useState<Box[]>([]);
  const [labels, setLabelsState] = React.useState<Labels>({});
  const [suggestions, setSuggestions] = React.useState<any>({});
  // State für ein-/ausklappbare Seitenleiste
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  // Trigger für Zoom-Anpassung im PDFViewer
  const [fitToContainerTrigger, setFitToContainerTrigger] = React.useState(0);
  // ...existing code...

  // Speichert Labels und aktuellen Stand im Backend
  const saveLabels = React.useCallback(
    async (newLabels: Labels, newSuggestions?: any, boxesOverride?: Box[]) => {
      if (!row || !row.id) return;
      try {
        await fetch(`${API_BASE}/ocr/boxes/`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            task_id: row.id,
            boxes: boxesOverride !== undefined ? boxesOverride : boxes,
            suggestions:
              newSuggestions !== undefined ? newSuggestions : suggestions,
            labels: newLabels,
          }),
        });
      } catch (err) {
        // Fehler beim Speichern ignorieren
      }
    },
    [row, token, boxes, suggestions]
  );

  // setLabels, das auch speichert
  const setLabels = React.useCallback(
    (newLabels: Labels, newSuggestions?: any) => {
      setLabelsState(newLabels);
      saveLabels(newLabels, newSuggestions);
    },
    [saveLabels]
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Stelle sicher, dass currentPage immer im gültigen Bereich liegt, wenn pages sich ändern
  React.useEffect(() => {
    if (currentPage > 0 && pages.length > 0 && currentPage >= pages.length) {
      onPageChange(pages.length - 1);
    }
    if (pages.length === 0 && currentPage !== 0) {
      onPageChange(0);
    }
  }, [pages, currentPage, onPageChange]);

  // Load PDF pages when row changes
  React.useEffect(() => {
    let cancelled = false;
    if (row && row.status === "done" && row.id) {
      setLoading(true);
      setError(null);
      fetch(`${API_BASE}/pdf_tasks/pages/${row.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => {
          if (!res.ok) throw new Error("Fehler beim Laden der PDF-Seiten");
          return res.json();
        })
        .then((data) => {
          if (!cancelled) {
            setPages(data.pages || []);
            onPageChange(0);
          }
        })
        .catch((err) => {
          if (!cancelled)
            setError(err.message || "Fehler beim Laden der PDF-Seiten");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      setPages([]);
      setError(null);
      setLoading(false);
      onPageChange(0);
    }
    return () => {
      cancelled = true;
    };
  }, [row, token, onPageChange]);

  // Boxen/Labels für die aktuelle Seite laden
  React.useEffect(() => {
    let cancelled = false;
    async function fetchBoxes() {
      if (!row || !row.id || !pages.length) {
        setBoxes([]);
        setLabelsState({}); // KEIN saveLabels/PUT beim Initialisieren!
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${API_BASE}/ocr/?task_id=${row.id}&page=${
            currentPage + 1
          }&trigger_ocr=false`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        if (res.status === 404) {
          // Keine Boxen vorhanden, aber kein Fehler!
          if (!cancelled) {
            setBoxes([]);
            setLabelsState({});
            setSuggestions({});
            if (onBoxChange) onBoxChange([], true); // <--- Dialog-Trigger
          }
          return;
        }
        if (!res.ok) {
          // Nur echte Fehler loggen (z.B. Netzwerkfehler, 500 etc.)
          if (!cancelled) {
            setError("Fehler beim Laden der Boxen/Labels");
          }
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setBoxes(data.boxes || []);
          setLabelsState(data.labels || {});
          setSuggestions(data.suggestions || {});
          if (onBoxChange) onBoxChange(data.boxes || [], false);
        }
      } catch (err) {
        // Nur echte Fehler loggen, 404 wird oben abgefangen
        if (!cancelled) {
          setError("Fehler beim Laden der Boxen/Labels");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchBoxes();
    return () => {
      cancelled = true;
    };
  }, [currentPage, pages, row, token]);

  // Handler for page navigation
  // Die Seitenwechsel-Logik wird jetzt über props.onPageChange gesteuert

  // Boxen/Labels speichern
  const handleBoxChange = async (newBoxes: Box[], isNotFound?: boolean) => {
    setBoxes(newBoxes);
    if (onBoxChange) {
      onBoxChange(newBoxes, isNotFound);
    }
    // Speichere Boxen/Labels im Backend (immer alle Felder mitsenden)
    // Nutze hier die aktuellen Werte aus den Parametern/State
    try {
      await fetch(`${API_BASE}/ocr/boxes/`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          task_id: row.id,
          boxes: newBoxes,
          suggestions: suggestions,
          labels: labels,
        }),
      });
    } catch (err) {
      // Fehler beim Speichern ignorieren (optimistisches Update)
    }
    // Prüfe, welche Box sich geändert hat (Anzahl gleich, aber Werte unterschiedlich)
    let changedIdx = -1;
    if (boxes.length === newBoxes.length) {
      for (let i = 0; i < boxes.length; i++) {
        const b1 = boxes[i];
        const b2 = newBoxes[i];
        if (
          b1.x !== b2.x ||
          b1.y !== b2.y ||
          b1.width !== b2.width ||
          b1.height !== b2.height
        ) {
          changedIdx = i;
          break;
        }
      }
    }
    // Wenn genau eine Box geändert wurde, führe extract_text für diese Box aus
    if (changedIdx !== -1 && row && row.id && pages.length) {
      try {
        const box = newBoxes[changedIdx];
        // Sende alle Werte als Integer
        const intBox = {
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
        };
        const res = await fetch(`${API_BASE}/ocr/extract_text/`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            task_id: row.id,
            page: currentPage + 1,
            boxes: [intBox],
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.boxes) && data.boxes.length === 1) {
            // Ersetze nur den Text der geänderten Box
            const updatedBoxes = [...newBoxes];
            updatedBoxes[changedIdx] = {
              ...updatedBoxes[changedIdx],
              text: data.boxes[0].text,
            };
            setBoxes(updatedBoxes);
            // Labels bleiben erhalten, da sie auf den Index zeigen
            // Boxen/Labels im Backend speichern (immer alle Felder mitsenden, direkt aus Response)
            await fetch(`${API_BASE}/ocr/boxes/`, {
              method: "PUT",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                task_id: row.id,
                boxes: updatedBoxes,
                suggestions: suggestions,
                labels: labels,
              }),
            });
            return;
          }
        }
      } catch (err) {
        // Fehler ignorieren, Boxen trotzdem setzen
      }
    }
    // Fallback: Wenn keine einzelne Box geändert wurde, setze einfach alle Boxen
    setBoxes(newBoxes);
    try {
      await fetch(`${API_BASE}/ocr/boxes/`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          task_id: row.id,
          boxes: newBoxes,
          suggestions: suggestions,
          labels: labels,
        }),
      });
    } catch (err) {
      // Fehler beim Speichern ignorieren (optimistisches Update)
    }
  };

  const handleRemoveBox = async (boxIdx: number) => {
    if (!row || !row.id || !pages.length) return;

    // Box entfernen (lokal)
    const newBoxes = boxes.filter((_, i) => i !== boxIdx);
    setBoxes(newBoxes);

    // Labels remappen: für jedes Label, suche neuen Index anhand des gemerkten Texts (außer gelöschte Box)
    const newLabels: Partial<Record<LabelKeys, number>> = {};
    (Object.keys(labels) as LabelKeys[]).forEach((label) => {
      const idx = labels[label];
      if (typeof idx === "number" && boxes[idx]) {
        const text = boxes[idx].text;
        if (text) {
          const newIdx = newBoxes.findIndex((b) => b.text === text);
          if (newIdx !== -1) newLabels[label] = newIdx;
        }
      }
    });
    setLabels(newLabels);

    // Jetzt einmalig Backend-Update
    await fetch(`${API_BASE}/ocr/boxes/`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task_id: row.id,
        boxes: newBoxes,
        suggestions: suggestions,
        labels: newLabels,
      }),
    });
  };

  // OCR-Logik: Boxen/Labels neu erkennen lassen
  const recognizeText = async () => {
    if (!row || !row.id || !pages.length) return false;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/ocr/?task_id=${row.id}&page=${
          currentPage + 1
        }&trigger_ocr=true`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!res.ok)
        throw new Error(
          "Fehler bei der Texterkennung (Status: " + res.status + ")"
        );
      const data = await res.json();
      if (!data || typeof data !== "object")
        throw new Error("Leere oder ungültige Antwort vom Backend");
      const newBoxes = Array.isArray(data.boxes) ? data.boxes : [];
      const newSuggestions =
        data.suggestions && typeof data.suggestions === "object"
          ? data.suggestions
          : {};
      setBoxes(newBoxes);
      setSuggestions(newSuggestions);
      // Suggestions vom Backend (Text) auf Box-Indizes mappen
      let mappedLabels: Partial<Record<LabelKeys, number>> = {};
      if (data.suggestions && typeof data.suggestions === "object") {
        Object.entries(data.suggestions).forEach(([label, text]) => {
          // Finde Index der Box, deren Text exakt (oder getrimmt) übereinstimmt
          const idx = newBoxes.findIndex(
            (b: Box) => b.text && b.text.trim() === String(text).trim()
          );
          if (idx !== -1) mappedLabels[label as LabelKeys] = idx;
        });
        setLabels(mappedLabels);
      } else {
        setLabels(
          data.labels && typeof data.labels === "object" ? data.labels : {}
        );
      }
      // Direkt nach OCR: Speichere alle aktuellen Werte im Backend
      await fetch(`${API_BASE}/ocr/boxes/`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          task_id: row.id,
          boxes: newBoxes,
          suggestions: newSuggestions,
          labels:
            mappedLabels && Object.keys(mappedLabels).length > 0
              ? mappedLabels
              : data.labels && typeof data.labels === "object"
              ? data.labels
              : {},
        }),
      });
      return true;
    } catch (err: any) {
      setError("Fehler bei der Texterkennung: " + (err?.message || err));
      return false;
    } finally {
      setLoading(false);
    }
  };

  React.useImperativeHandle(
    ref,
    () => ({
      recognizeText,
    }),
    [row, pages, currentPage, token]
  );
  return (
    <div
      className={
        row.status === "done"
          ? "flex gap-6 w-full overflow-x-auto items-start box-border mx-auto"
          : "min-w-[600px] max-w-2xl"
      }
      style={
        row.status === "done" ? { maxWidth: "calc(100vw - 256px - 64px)" } : {}
      }
    >
      {/* PDF-Viewer Card */}
      <div
        className="bg-white rounded-xl shadow-md p-8 border border-gray-100 relative min-w-[400px] flex-1 max-w-full transition-all duration-300"
        style={
          row.status === "done"
            ? {
                minWidth: 0,
                maxWidth: sidebarOpen
                  ? "calc(100vw - 256px - 700px - 96px)"
                  : "calc(100vw - 256px - 64px)",
                transition: "max-width 0.3s",
              }
            : { minWidth: 0 }
        }
      >
        <h2 className="text-lg font-semibold mb-2">{row.filename}</h2>
        {row.status === "done" ? (
          <>
            {pages && pages.length > 0 && (
              <Suspense
                fallback={
                  <div className="w-full h-[70vh] flex items-center justify-center text-gray-500">
                    <div className="animate-pulse">{t("loading")}</div>
                  </div>
                }
              >
                <PDFViewer
                  pages={pages}
                  currentPage={currentPage}
                  boxes={boxes}
                  labels={labels}
                  loading={loading}
                  error={error}
                  onPageChange={onPageChange}
                  onBoxChange={handleBoxChange}
                  onRecognizeText={recognizeText}
                  onAssignLabel={undefined}
                  onRemoveBox={handleRemoveBox}
                  fitToContainerTrigger={fitToContainerTrigger}
                  token={token}
                />
              </Suspense>
            )}
            {pages && pages.length === 0 && !loading && !error && (
              <div className="text-gray-500 mt-4">{t("no_pages_found")}</div>
            )}
          </>
        ) : (
          <>
            <div className="mt-2 text-gray-600">
              {t("status")}: {row.status}
            </div>
            <div className="mt-2 text-gray-600">
              {t("num_pages")}: {row.num_pages}
            </div>
            <div className="mt-2 text-gray-600">
              {t("created_at")}: {row.created_at}
            </div>
          </>
        )}
        {/* Toggle-Button für Seitenleiste */}
        {row.status === "done" && (
          <button
            className="absolute top-4 right-4 z-20 bg-gray-200 hover:bg-gray-300 rounded-full p-2 shadow transition"
            style={{ outline: "none" }}
            onClick={() => {
              setSidebarOpen((v) => {
                // Nach dem Umschalten Zoom anpassen
                setTimeout(() => setFitToContainerTrigger((t) => t + 1), 150); // nach CSS-Transition
                return !v;
              });
            }}
            title={
              sidebarOpen
                ? t("hide_sidebar", "Seitenleiste ausblenden")
                : t("show_sidebar", "Seitenleiste einblenden")
            }
          >
            <span className="sr-only">
              {sidebarOpen
                ? t("hide_sidebar", "Seitenleiste ausblenden")
                : t("show_sidebar", "Seitenleiste einblenden")}
            </span>
            {sidebarOpen ? (
              <ChevronRight size={20} color="#374151" />
            ) : (
              <ChevronLeft size={20} color="#374151" />
            )}
          </button>
        )}
      </div>
      {/* OCR-Erkennung Card (Seitenleiste) */}
      {row.status === "done" && sidebarOpen && (
        <div
          className="bg-white rounded-xl shadow-md p-8 border border-gray-100 transition-all duration-300"
          style={{ width: "700px", minWidth: "700px", maxWidth: "700px" }}
        >
          <h2 className="text-lg font-semibold mb-2">OCR-Erkennung</h2>
          <Suspense
            fallback={<div className="text-gray-500">{t("loading")}</div>}
          >
            <OcrLabelAssignment
              boxes={boxes}
              labels={labels}
              setLabels={setLabels}
              t={t}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
});

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "";
const API_BASE = `${SERVER_URL}/api/v1`;

export interface DocumentDetailCardHandle {
  recognizeText: () => Promise<boolean>;
}

interface DocumentUploadPageProps {
  initialId?: string;
  token: string;
}

const DocumentUploadPage: React.FC<DocumentUploadPageProps> = ({
  initialId,
  token,
}) => {
  // ViewRow-Logik wird jetzt zentral im MasterDataTemplate gehandhabt
  const [viewRow, setViewRow] = useState<any | null>(null);
  // Ref für Detailansicht
  const detailCardRef = React.useRef<DocumentDetailCardHandle>(null);

  // State für die aktuell angezeigte Seite
  const [currentPage, setCurrentPage] = useState<number>(0);

  // State für Overlay "Keine OCR-Boxen"
  const [showNoOcrOverlay, setShowNoOcrOverlay] = useState(false);
  const [detailBoxes, setDetailBoxes] = useState<Box[] | null>(null);

  // Toolbar-Button für Text Erkennung (OCR) und Linien-Visualisierung
  const ocrToolbarButton = (row: any): React.ReactElement | null => {
    if (!row || row.status !== "done") return null;
    return (
      <div className="flex gap-2">
        <button
          className="flex flex-col items-center justify-center rounded-full w-16 h-16 bg-blue-600 text-white hover:bg-blue-700 border transition"
          onClick={() => detailCardRef.current?.recognizeText()}
          title={t(
            "ocr_recognitionHint",
            "Texterkennung für diese Seite starten"
          )}
        >
          <ScanText size={28} />
          <span className="text-xs mt-1 text-white">
            {t("ocr_recognition", "Texterkennung")}
          </span>
        </button>
      </div>
    );
  };

  // Effekt: Prüfe, ob Detailansicht geöffnet ist und Boxen leer sind
  useEffect(() => {
    // Nur prüfen, wenn Detailansicht offen ist
    if (viewRow && viewRow.status === "done") {
      // Hole Boxen für aktuelle Seite aus PDFViewer/DetailCard
      // Da die Boxen im DetailCard State sind, hole sie über einen ImperativeHandle
      // Alternativ: Boxen als State im DocumentUploadPage pflegen (hier: über Callback)
      // Wir nutzen einen kleinen Workaround: PDFViewer ruft onBoxChange, wir setzen detailBoxes
      // Initial: Wenn viewRow wechselt, Boxen zurücksetzen
      setDetailBoxes(null);
      setShowNoOcrOverlay(false);
    } else {
      setDetailBoxes(null);
      setShowNoOcrOverlay(false);
    }
  }, [viewRow, currentPage]);
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("DocumentUploadPage");
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Ausgelagerte Renderfunktion für Statusspalte
  const renderStatus = (val: string) => {
    if (val === "done")
      return <span className="text-green-600">{t("status_done")}</span>;
    if (val === "processing")
      return (
        <span className="text-blue-600 animate-pulse">
          {t("status_processing")}
        </span>
      );
    if (val === "pending")
      return (
        <span className="text-yellow-600 animate-pulse">
          {t("status_pending")}
        </span>
      );
    if (val === "error")
      return <span className="text-red-600">{t("status_error")}</span>;
    return val;
  };

  const columns = React.useMemo(
    () => [
      {
        key: "filename",
        label: t("filename"),
      },
      {
        key: "status",
        label: t("status"),
        render: renderStatus,
        displayValue: (val: string) => {
          if (val === "done") return t("status_done");
          if (val === "processing") return t("status_processing");
          if (val === "error") return t("status_error");
          return val;
        },
      },
      {
        key: "num_pages",
        label: t("num_pages"),
      },
      {
        key: "created_at",
        label: t("created_at"),
        type: "datetime",
      },
    ],
    [i18n.language, t]
  );

  const [data, setData] = useState<any[]>([]);
  const dataRef = useRef<any[]>(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // Status-Tracking für Toast "Datei verarbeitet"
  const prevStatusRef = useRef<Record<string, string>>({});
  useEffect(() => {
    // Mappe aktuelle Status
    const statusMap: Record<string, string> = {};
    data.forEach((d: any) => {
      if (d.id && d.status) statusMap[d.id] = d.status;
    });
    // Vergleiche mit vorherigem Status
    Object.entries(statusMap).forEach(([id, status]) => {
      const prev = prevStatusRef.current[id];
      if (prev && prev !== "done" && status === "done") {
        // Finde das Dokument
        const doc = data.find((d: any) => String(d.id) === id);
        if (doc) {
          toast.success(
            <div>
              {t("toast_file_processed", { filename: doc.filename })}
              <br />
              <Link
                to={`/documentsupload/${doc.id}`}
                className="underline text-blue-700 hover:text-blue-900"
              >
                {t("toast_file_link")}
              </Link>
            </div>,
            { className: "toast-success-bg", icon: null, duration: 8000 }
          );
        }
      }
    });
    prevStatusRef.current = statusMap;
  }, [data, t]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ...existing code...
  // Für dynamische Detailansicht: PDF-Seitenbilder
  const [pdfPages, setPdfPages] = useState<string[] | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // Lädt die Seitenbilder, wenn Status 'done' und viewRow gesetzt
  useEffect(() => {
    if (viewRow && viewRow.status === "done" && viewRow.id) {
      setPdfLoading(true);
      setPdfError(null);
      fetch(`${API_BASE}/pdf_tasks/pages/${viewRow.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => {
          if (!res.ok) throw new Error("Fehler beim Laden der Seiten");
          return res.json();
        })
        .then((data) => {
          setPdfPages(Array.isArray(data.pages) ? data.pages : []);
        })
        .catch((err) => {
          setPdfError(err.message || "Fehler beim Laden der Seiten");
          setPdfPages([]);
        })
        .finally(() => setPdfLoading(false));
    } else {
      setPdfPages(null);
      setPdfError(null);
      setPdfLoading(false);
    }
  }, [viewRow, token]);

  // fetchData als eigene Funktion, damit sie auch für onAfterSave genutzt werden kann
  const fetchData = async () => {
    if (!token) {
      // Kein Token: nicht pollen
      setError(null);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/pdf_tasks/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(t("load_error"));
      const tasks = await res.json();
      const oldStr = JSON.stringify(dataRef.current);
      const newStr = JSON.stringify(tasks);
      if (oldStr !== newStr) {
        setLoading(true);
        try {
          setData(tasks);
        } catch (error) {
          setError(t("load_error on setData"));
        } finally {
          setLoading(false);
        }
      }
      setError(null);
    } catch (err) {
      setError(t("load_error"));
    }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout | undefined;
    if (token) {
      fetchData();
      interval = setInterval(() => {
        if (viewRow === null) {
          fetchData();
        }
      }, 5000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [viewRow, token]);

  // Upload-Dialog: Datei auswählen
  const handleFileInputClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setUploadFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      const res = await fetch(`${API_BASE}/pdf_tasks/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error(t("load_error"));
      setShowUploadDialog(false);
      setUploadFile(null);
      fetchData();
    } catch (err) {
      setError(t("load_error"));
    } finally {
      setUploading(false);
    }
  };

  // Renderfunktion für Edit-Overlay (Neuanlage/Upload)
  // Drag & Drop State für Overlay
  const [dragActive, setDragActive] = useState(false);
  const renderEditMode = React.useCallback(
    (
      _editData: any,
      _setEditData: (data: any) => void,
      _handleSave: () => void,
      handleCancel: () => void,
      editSaving: boolean,
      editError: string,
      isNew: boolean,
      _firstInputRef: React.RefObject<HTMLInputElement | null>
    ) => (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
        <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-md relative">
          <h2 className="text-lg font-semibold mb-4">
            {t("upload_new_document")}
          </h2>
          {editError && <div className="text-red-600 mb-2">{editError}</div>}
          {/* Drag & Drop Bereich wie in VoiceScanPage */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragActive(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                setUploadFile(e.dataTransfer.files[0]);
              }
            }}
            className={`w-full mb-4 p-6 border-2 border-dashed rounded transition-colors duration-200 ${
              dragActive
                ? "border-blue-500 bg-blue-50"
                : "border-gray-300 bg-gray-100"
            }`}
          >
            <p className="text-center text-gray-500">
              {t("drag_drop_text")}{" "}
              <button
                type="button"
                onClick={handleFileInputClick}
                className="text-blue-600 underline hover:text-blue-800 focus:outline-none"
                tabIndex={0}
                disabled={editSaving}
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
          {uploadFile && (
            <div className="mb-2 text-sm text-gray-700 text-center">
              {t("selected_file", "Ausgewählte Datei:")}{" "}
              <span className="font-semibold">{uploadFile.name}</span>
            </div>
          )}
          <div className="flex justify-end gap-3 mt-6">
            <button
              className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
              onClick={() => {
                handleCancel();
                setUploadFile(null);
              }}
              disabled={editSaving}
            >
              {t("cancel")}
            </button>
            <button
              className={`px-4 py-2 rounded ${
                uploadFile
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-gray-300 text-gray-500 cursor-not-allowed"
              }`}
              onClick={async () => {
                if (!uploadFile) return;
                setUploading(true);
                try {
                  const formData = new FormData();
                  formData.append("file", uploadFile);
                  const res = await fetch(`${API_BASE}/pdf_tasks/upload`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}` },
                    body: formData,
                  });
                  if (!res.ok) throw new Error(t("load_error"));
                  setUploadFile(null);
                  handleCancel();
                } catch (err) {
                  setError(t("load_error"));
                } finally {
                  setUploading(false);
                }
              }}
              disabled={!uploadFile || editSaving || uploading}
              type="button"
            >
              {t("upload_document")}
            </button>
          </div>
        </div>
      </div>
    ),
    [t, uploadFile, uploading, dragActive]
  );

  // Drag&Drop auf die Übersichtsseite (direkter Upload)
  const [pageDragActive, setPageDragActive] = useState(false);
  const handlePageDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setPageDragActive(true);
  };
  const handlePageDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setPageDragActive(false);
  };
  const handlePageDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setPageDragActive(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type !== "application/pdf") {
        toast.error(t("toast_filetype_error"));
        return;
      }
      try {
        toast.loading(t("toast_uploading", { filename: file.name }), {
          id: "uploading",
        });
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(`${API_BASE}/pdf_tasks/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (!res.ok) throw new Error();
        navigate("/documentsupload");
        fetchData();
      } catch {
        toast.error(t("toast_file_error"));
      }
    }
  };

  return (
    <div
      onDragOver={viewRow === null ? handlePageDragOver : undefined}
      onDragLeave={viewRow === null ? handlePageDragLeave : undefined}
      onDrop={viewRow === null ? handlePageDrop : undefined}
      className={
        pageDragActive && viewRow === null ? "relative bg-blue-50" : "relative"
      }
      style={{ minHeight: 400 }}
    >
      {pageDragActive && viewRow === null && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-blue-100 bg-opacity-80 pointer-events-none">
          <div className="text-2xl text-blue-700 font-semibold border-2 border-blue-400 rounded-lg px-8 py-6 shadow-lg">
            {t("drag_drop_text", "PDF-Datei hierher ziehen zum Hochladen")}
          </div>
        </div>
      )}
      <MasterDataTemplate
        endpoint={`${API_BASE}/pdf_tasks`}
        columns={columns}
        data={data}
        loading={loading}
        error={error || undefined}
        idField="id"
        pageSize={20}
        renderEditMode={renderEditMode}
        renderViewMode={(row) => (
          <>
            <DocumentDetailCard
              ref={detailCardRef}
              row={row}
              token={token}
              t={t}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
              // Callback für Boxen-Änderung, um State zu setzen
              onBoxChange={(boxes: Box[], isNotFound?: boolean) => {
                setDetailBoxes(boxes);
                if (row.status === "done" && isNotFound) {
                  setShowNoOcrOverlay(true);
                } else {
                  setShowNoOcrOverlay(false);
                }
              }}
            />
            {/* Overlay anzeigen, wenn keine Boxen vorhanden */}
            {showNoOcrOverlay && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
                <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-md relative">
                  <h2 className="text-lg font-semibold mb-4">
                    {t(
                      "no_ocr_boxes_title",
                      "Keine Texterkennung durchgeführt"
                    )}
                  </h2>
                  <p className="mb-4 text-gray-700">
                    {t(
                      "no_ocr_boxes_text",
                      "Für dieses Dokument wurde noch keine Texterkennung durchgeführt. Möchten Sie jetzt starten?"
                    )}
                  </p>
                  <div className="flex justify-end gap-3 mt-6">
                    <button
                      className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
                      onClick={() => setShowNoOcrOverlay(false)}
                    >
                      {t("cancel", "Abbrechen")}
                    </button>
                    <button
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                      onClick={async () => {
                        setShowNoOcrOverlay(false);
                        await detailCardRef.current?.recognizeText();
                      }}
                    >
                      {t("start_ocr", "Texterkennung starten")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        onAfterSave={fetchData}
        onAfterDelete={fetchData}
        detailviewLinkFields={["filename"]}
        detailBasePath="/documentsupload"
        token={token}
        viewRow={viewRow}
        setViewRow={setViewRow}
        initialId={initialId}
        toolbarActions={ocrToolbarButton}
      />
    </div>
  );
};

export default DocumentUploadPage;
