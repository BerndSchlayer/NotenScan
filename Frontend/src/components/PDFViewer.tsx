import React, { useState, useEffect, useRef, useImperativeHandle } from "react";
import { Trash2 } from "lucide-react";
import { Rnd } from "react-rnd";
import { useTranslation } from "react-i18next";

const labelColors = {
  Titel: "#0ea5e9",
  Komponist: "#22c55e",
  Arrangeur: "#eab308",
  Stimme: "#8b5cf6",
  Genre: "#ec4899",
};

// Typdefinitionen
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}
type LabelKeys = "Titel" | "Komponist" | "Arrangeur" | "Stimme" | "Genre";
type Labels = Partial<Record<LabelKeys, number>>; // Label → Box-Index
type LabelBoxMap = Partial<Record<LabelKeys, number>>; // bleibt für Ref

// Öffentliche Props (teils optional für unkontrollierten Modus)
export interface PDFViewerProps {
  pages: string[];
  currentPage?: number;
  boxes?: Box[];
  labels?: Labels;
  loading?: boolean;
  error?: string | null;
  onPageChange?: (pageIdx: number) => void;
  onBoxChange?: (boxes: Box[]) => void;
  onRecognizeText?: () => void | Promise<void> | Promise<boolean>;
  onAssignLabel?: (label: LabelKeys, boxIdx: number) => void;
  onRemoveBox?: (boxIdx: number) => void;
  token: string;
}

// Imperatives Handle für Eltern-Komponenten
export interface PDFViewerHandle {
  setPage: (pageIdx: number) => void;
  recognizeText: () => void | Promise<void>;
  getCurrentBoxesAndLabels: () => {
    boxes: Box[];
    labels: Partial<Record<LabelKeys, string>>;
  };
}

const PDFViewer = React.forwardRef<
  PDFViewerHandle,
  PDFViewerProps & { fitToContainerTrigger?: number }
>(({ pages, token, fitToContainerTrigger = 0, ...rest }, ref) => {
  const { t } = useTranslation("PDFViewer");
  const [zoom, setZoom] = useState<number>(1.0);
  const [zoomKey, setZoomKey] = useState<number>(0);
  const [userZoomed, setUserZoomed] = useState<boolean>(false);
  const [selectedBox, setSelectedBox] = useState<number | null>(null);
  // Unkontrollierter Modus: interne States
  const [internalPage, setInternalPage] = useState<number>(0);
  const [internalBoxes, setInternalBoxes] = useState<Box[]>(rest.boxes ?? []);
  const [internalLabels, setInternalLabels] = useState<Labels>(
    rest.labels ?? {}
  );
  // Kontextmenü State
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    boxIdx: number | null;
  }>({ visible: false, x: 0, y: 0, boxIdx: null });

  // Kontrolliert/unkontrolliert zusammenführen
  useEffect(() => {
    if (rest.boxes) setInternalBoxes(rest.boxes);
  }, [rest.boxes]);
  useEffect(() => {
    if (rest.labels) setInternalLabels(rest.labels);
  }, [rest.labels]);

  const currentPage = rest.currentPage ?? internalPage;
  const boxes = rest.boxes ?? internalBoxes;
  const labels = rest.labels ?? internalLabels;
  const onPageChange = rest.onPageChange ?? setInternalPage;
  const onBoxChange = rest.onBoxChange ?? setInternalBoxes;
  const onAssignLabel =
    rest.onAssignLabel ??
    ((label: LabelKeys, boxIdx: number) => {
      setInternalLabels((prev) => ({ ...prev, [label]: boxIdx }));
    });
  const onRemoveBox =
    rest.onRemoveBox ??
    ((boxIdx: number) => {
      setInternalBoxes((prev) => prev.filter((_, i) => i !== boxIdx));
      setInternalLabels((prev) => {
        const updated: Labels = {};
        (Object.keys(prev) as LabelKeys[]).forEach((k) => {
          const v = prev[k];
          if (typeof v === "number") {
            if (v === boxIdx) return; // Label entfernen
            updated[k] = v > boxIdx ? v - 1 : v;
          }
        });
        return updated;
      });
    });

  // Imperative Methoden bereitstellen
  useImperativeHandle(ref, () => ({
    setPage: (idx: number) => {
      const bounded = Math.max(0, Math.min(pages.length - 1, idx));
      onPageChange(bounded);
    },
    recognizeText: () => {
      if (rest.onRecognizeText) {
        const result = rest.onRecognizeText();
        // Normalisiere Promise<boolean|void> -> Promise<void>
        if (result && typeof (result as any).then === "function") {
          return (result as Promise<any>).then(() => {});
        }
      }
    },
    getCurrentBoxesAndLabels: () => {
      const labelsText: Partial<Record<LabelKeys, string>> = {};
      (Object.keys(labels) as LabelKeys[]).forEach((k) => {
        const idx = labels[k];
        if (typeof idx === "number" && boxes[idx]) {
          labelsText[k] = boxes[idx].text;
        }
      });
      return { boxes, labels: labelsText };
    },
  }));

  // Handler für Kontextmenü-Auswahl
  const handleAssignLabel = (label: LabelKeys) => {
    console.debug("[PDFViewer] handleAssignLabel", {
      label,
      contextMenu,
      onAssignLabel,
    });
    if (contextMenu.boxIdx !== null) {
      onAssignLabel(label, contextMenu.boxIdx);
    }
    setContextMenu({ visible: false, x: 0, y: 0, boxIdx: null });
  };

  const handleRemoveBox = () => {
    if (contextMenu.boxIdx !== null && onRemoveBox) {
      onRemoveBox(contextMenu.boxIdx);
    }
    setContextMenu({ visible: false, x: 0, y: 0, boxIdx: null });
  };

  // Schließe Kontextmenü bei Klick außerhalb
  useEffect(() => {
    if (!contextMenu.visible) return;
    // Verzögere das Schließen, damit onClick im Menü feuert
    const handleClick = (e: MouseEvent) => {
      // Prüfe, ob der Klick im Kontextmenü war
      const menu = document.querySelector(".context-menu-box");
      if (menu && e.target && menu.contains(e.target as Node)) {
        // Klick im Menü: NICHT sofort schließen
        return;
      }
      // Sonst: mit Timeout schließen
      setTimeout(() => {
        setContextMenu({ visible: false, x: 0, y: 0, boxIdx: null });
      }, 50);
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [contextMenu.visible]);
  const [imageLoaded, setImageLoaded] = useState<boolean>(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- Deskew/Rotation Dialog State ---
  const [showDeskewDialog, setShowDeskewDialog] = useState(false);
  const [deskewAngle, setDeskewAngle] = useState(0);
  // Backend-Anbindung für Deskew
  const [savingDeskew, setSavingDeskew] = useState(false);
  const handleDeskewSave = async () => {
    if (!pages || !pages[currentPage]) return;
    // Extrahiere task_id aus Bild-URL
    // Beispiel: .../static/{task_id}/pages/{task_id}_page_00001.png
    const match = pages[currentPage].match(/\/static\/(.*?)\/pages\//);
    const taskId = match ? match[1] : null;
    // Token kommt jetzt als Prop
    if (!taskId) {
      alert("task_id konnte nicht aus der Bild-URL extrahiert werden.");
      return;
    }
    setSavingDeskew(true);
    try {
      await fetch(
        `${import.meta.env.VITE_SERVER_URL || ""}/api/v1/pdf_tasks/deskew`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            task_id: taskId,
            page: currentPage + 1,
            angle: deskewAngle,
          }),
        }
      );
      // Nach erfolgreichem Speichern: Bild neu laden (Cache-Buster)
      setShowDeskewDialog(false);
      setDeskewAngle(0);
      // Bild-URL aktualisieren
      const newPages = [...pages];
      newPages[currentPage] = `${pages[currentPage]}?t=${Date.now()}`;
      // setPages gibt es hier nicht, aber Parent kann per Prop reagieren
      // Workaround: force reload über Zoom-Key
      setZoomKey((k) => k + 1);
    } catch (err) {
      alert("Fehler beim Speichern der Ausrichtung.");
    } finally {
      setSavingDeskew(false);
    }
  };

  // Entferne die automatische Zoom-Berechnung aus useEffect
  // Die Zoom-Berechnung erfolgt jetzt direkt im onLoad-Handler des Bildes

  // Setze userZoomed auf true, wenn der User den Slider benutzt
  const handleZoomChange = (value: string | number) => {
    setZoom(Number(value));
    setUserZoomed(true);
  };

  // Navigation
  const prevPage = () => {
    if (currentPage > 0) onPageChange(currentPage - 1);
  };
  const nextPage = () => {
    if (pages && currentPage < pages.length - 1) onPageChange(currentPage + 1);
  };

  // Box-Interaktion (z.B. verschieben, Größe ändern)
  const updateBox = (boxIndex: number, newBox: Partial<Box>) => {
    const updated = boxes.map((b, i) =>
      i === boxIndex ? { ...b, ...newBox } : b
    );
    onBoxChange(updated);
  };

  // State for page input value
  const [inputPageValue, setInputPageValue] = useState<string>(
    pages.length > 0 ? (currentPage + 1).toString() : ""
  );

  // Keep input value in sync with currentPage and pages.length
  useEffect(() => {
    setInputPageValue(pages.length > 0 ? (currentPage + 1).toString() : "");
  }, [currentPage, pages.length]);

  // Render
  return (
    <div className="flex flex-col h-full w-full relative">
      {/* Page information header mit Zoom Controls */}
      <div className="w-full bg-gray-100 py-2 px-4 text-sm font-medium text-gray-700 border-b flex flex-wrap items-center justify-between gap-2">
        {/* Zoom Controls links */}
        <div
          className="flex flex-wrap items-center gap-2 min-w-0 flex-1"
          style={{ flexBasis: "300px" }}
        >
          <span className="text-xs text-gray-600 whitespace-nowrap">
            {t("zoom", "Zoom:")}
          </span>
          <input
            type="range"
            min={0.2}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => handleZoomChange(e.target.value)}
            className="flex-grow min-w-0 max-w-[120px]"
          />
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="w-12 text-center whitespace-nowrap">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => {
                setZoom(1.0);
                setZoomKey((k) => k + 1);
                setUserZoomed(false);
              }}
              className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 text-xs whitespace-nowrap"
              title={t("reset", "Reset")}
            >
              {t("reset", "Reset")}
            </button>
          </div>
        </div>
        {/* Seiteninfo rechts: Eingabefeld + Buttons */}
        <div className="flex items-center gap-2 flex-1 justify-end min-w-0">
          <button
            onClick={prevPage}
            disabled={currentPage === 0}
            className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 text-xs"
            title={t("prev")}
          >
            &lt;
          </button>
          <input
            type="number"
            min={1}
            max={pages.length}
            value={inputPageValue}
            onChange={(e) => {
              setInputPageValue(e.target.value);
            }}
            onBlur={() => {
              let val = Number(inputPageValue);
              if (isNaN(val)) val = currentPage + 1;
              val = Math.max(1, Math.min(pages.length, val));
              if (val - 1 !== currentPage) onPageChange(val - 1);
              setInputPageValue(val.toString());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                let val = Number(inputPageValue);
                if (isNaN(val)) val = currentPage + 1;
                val = Math.max(1, Math.min(pages.length, val));
                if (val - 1 !== currentPage) onPageChange(val - 1);
                setInputPageValue(val.toString());
              }
            }}
            className="w-10 text-center border rounded px-1 py-0.5 text-sm no-spinner"
            style={{ minWidth: 28, appearance: "textfield" }}
            disabled={pages.length === 0}
          />
          <span className="whitespace-nowrap">
            {t("of")} {pages.length}
          </span>
          <button
            onClick={nextPage}
            disabled={currentPage === pages.length - 1}
            className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 text-xs"
            title={t("next")}
          >
            &gt;
          </button>
        </div>
      </div>
      {/* Bild-Container mit overflow: auto, OHNE Flexbox */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          position: "relative",
          background: "#fff",
          overflow: "auto",
        }}
      >
        {/* Deskew-Button oben rechts */}
        {pages.length > 0 && (
          <button
            className="absolute top-4 right-4 z-20 bg-yellow-400 hover:bg-yellow-500 text-white rounded-full p-2 shadow transition"
            style={{ outline: "none" }}
            onClick={() => {
              setShowDeskewDialog(true);
              setDeskewAngle(0);
            }}
            title={t("deskew_page", "Seite ausrichten")}
          >
            <span className="sr-only">
              {t("deskew_page", "Seite ausrichten")}
            </span>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M4 10a6 6 0 1112 0" stroke="#fff" strokeWidth="2" />
              <path d="M10 4v6l4 2" stroke="#fff" strokeWidth="2" />
            </svg>
          </button>
        )}
        {pages.length > 0 && (
          <div
            style={{
              position: "relative",
              display: "block",
              marginLeft: "auto",
              marginRight: "auto",
              ...(() => {
                const img = imageRef.current;
                if (img) {
                  return {
                    width: `${img.naturalWidth * zoom}px`,
                    height: `${img.naturalHeight * zoom}px`,
                  };
                } else {
                  return {
                    width: "0px",
                    height: "0px",
                  };
                }
              })(),
            }}
          >
            <img
              key={zoomKey}
              ref={imageRef}
              src={
                pages[currentPage] +
                (pages[currentPage].includes("?")
                  ? `&cb=${zoomKey}`
                  : `?cb=${zoomKey}`)
              }
              alt={`${t("page")} ${currentPage + 1}`}
              style={{
                ...(() => {
                  const img = imageRef.current;
                  if (img) {
                    return {
                      width: `${img.naturalWidth * zoom}px`,
                      height: `${img.naturalHeight * zoom}px`,
                    };
                  } else {
                    return {
                      width: "0px",
                      height: "0px",
                    };
                  }
                })(),
                display: "block",
                position: "absolute",
                left: 0,
                top: 0,
                zIndex: 1,
                transform: showDeskewDialog
                  ? `rotate(${deskewAngle}deg)`
                  : undefined,
                transition: showDeskewDialog ? "transform 0.2s" : undefined,
              }}
              className="shadow"
              onLoad={() => {
                setImageLoaded(true);
                // Automatische Zoom-Berechnung NUR wenn userZoomed == false
                if (!userZoomed && imageRef.current && containerRef.current) {
                  const img = imageRef.current;
                  const container = containerRef.current;
                  if (img.naturalWidth > 0 && container.offsetWidth > 0) {
                    const targetZoom = Math.min(
                      3,
                      Math.max(
                        0.2,
                        (container.offsetWidth * 0.8) / img.naturalWidth
                      )
                    );
                    setZoom(targetZoom);
                    setUserZoomed(false);
                  }
                }
              }}
            />
            {/* Deskew Dialog Overlay */}
            {showDeskewDialog && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
                <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-md relative">
                  <h2 className="text-lg font-semibold mb-4">
                    {t("deskew_title", "Seite ausrichten")}
                  </h2>
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-full flex gap-2 items-center justify-center mb-2">
                      <button
                        className="px-3 py-2 bg-gray-200 rounded hover:bg-gray-300"
                        onClick={() => setDeskewAngle((a) => a - 90)}
                        title="90° links"
                      >
                        ⟲ 90°
                      </button>
                      <input
                        type="range"
                        min={-10}
                        max={10}
                        step={0.1}
                        value={deskewAngle}
                        onChange={(e) => setDeskewAngle(Number(e.target.value))}
                        className="flex-grow mx-2"
                        style={{ maxWidth: 180 }}
                      />
                      <button
                        className="px-3 py-2 bg-gray-200 rounded hover:bg-gray-300"
                        onClick={() => setDeskewAngle((a) => a + 90)}
                        title="90° rechts"
                      >
                        ⟳ 90°
                      </button>
                    </div>
                    <div className="text-center text-gray-600 mb-2">
                      Winkel: {deskewAngle}°
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 mt-6">
                    <button
                      className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
                      onClick={() => {
                        setShowDeskewDialog(false);
                        setDeskewAngle(0);
                      }}
                    >
                      Abbrechen
                    </button>
                    <button
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                      onClick={handleDeskewSave}
                    >
                      Speichern
                    </button>
                  </div>
                </div>
              </div>
            )}
            {imageLoaded &&
              imageRef.current &&
              boxes.map((box, i) => {
                const img = imageRef.current;
                if (!img) return null;
                const scaleX = (img.naturalWidth * zoom) / img.naturalWidth;
                const scaleY = (img.naturalHeight * zoom) / img.naturalHeight;
                const left = box.x * scaleX;
                const top = box.y * scaleY;
                const width = box.width * scaleX;
                const height = box.height * scaleY;
                // Finde das Label, das auf diesen Box-Index zeigt
                const assignedLabel = Object.entries(labels).find(
                  ([, val]) => val === i
                )?.[0];
                const color = assignedLabel
                  ? labelColors[assignedLabel as LabelKeys]
                  : "#4b5563";
                const isSelected = selectedBox === i;

                return (
                  <Rnd
                    key={i}
                    size={{ width, height }}
                    position={{ x: left, y: top }}
                    bounds="parent"
                    onDragStop={(_, d) => {
                      const newX = d.x / scaleX;
                      const newY = d.y / scaleY;
                      updateBox(i, { x: newX, y: newY });
                    }}
                    onResizeStop={(_, __, ref, ___, position) => {
                      const newWidth = ref.offsetWidth / scaleX;
                      const newHeight = ref.offsetHeight / scaleY;
                      const newX = position.x / scaleX;
                      const newY = position.y / scaleY;
                      updateBox(i, {
                        x: newX,
                        y: newY,
                        width: newWidth,
                        height: newHeight,
                      });
                    }}
                    enableResizing={true}
                    style={{
                      border: `2px solid ${color}`,
                      backgroundColor: isSelected
                        ? "rgba(245, 158, 11, 0.2)"
                        : "rgba(255,255,255,0)",
                      position: "absolute",
                      cursor: "move",
                      zIndex: 2,
                    }}
                    title={`${t("recognized_text", "Erkannter Text")}: ${
                      box.text
                    }`}
                    onClick={() => setSelectedBox(i)}
                    onContextMenu={(e: React.MouseEvent) => {
                      e.preventDefault();
                      setContextMenu({
                        visible: true,
                        x: e.clientX,
                        y: e.clientY,
                        boxIdx: i,
                      });
                    }}
                  />
                );
              })}
            {/* Navigation buttons */}
            <button
              onClick={prevPage}
              disabled={currentPage === 0}
              className="absolute left-2 top-1/2 transform -translate-y-1/2 bg-gray-300 hover:bg-gray-400 text-white rounded-full p-2 shadow disabled:opacity-50 flex items-center justify-center"
              style={{ zIndex: 10 }}
              title={t("prev")}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-6 h-6"
              >
                <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z" />
              </svg>
            </button>
            <button
              onClick={nextPage}
              disabled={currentPage === pages.length - 1}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-gray-300 hover:bg-gray-400 text-white rounded-full p-2 shadow disabled:opacity-50 flex items-center justify-center"
              style={{ zIndex: 10 }}
              title={t("next")}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-6 h-6"
              >
                <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {/* Kontextmenü für Boxen */}
      {contextMenu.visible && (
        <ul
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 10000,
            background: "white",
            border: "1px solid #ccc",
            borderRadius: 4,
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            padding: 0,
            margin: 0,
            minWidth: 160,
          }}
          className="context-menu-box"
        >
          <li
            className="px-4 py-2 hover:bg-blue-100 cursor-pointer"
            onClick={() => handleAssignLabel("Titel")}
          >
            {t("assign_title", "Titel zuweisen")}
          </li>
          <li
            className="px-4 py-2 hover:bg-blue-100 cursor-pointer"
            onClick={() => handleAssignLabel("Komponist")}
          >
            {t("assign_composer", "Komponist zuweisen")}
          </li>
          <li
            className="px-4 py-2 hover:bg-blue-100 cursor-pointer"
            onClick={() => handleAssignLabel("Arrangeur")}
          >
            {t("assign_arranger", "Arrangeur zuweisen")}
          </li>
          <li
            className="px-4 py-2 hover:bg-blue-100 cursor-pointer"
            onClick={() => handleAssignLabel("Stimme")}
          >
            {t("assign_voice", "Stimme zuweisen")}
          </li>
          <li
            className="px-4 py-2 hover:bg-blue-100 cursor-pointer"
            onClick={() => handleAssignLabel("Genre")}
          >
            {t("assign_genre", "Genre zuweisen")}
          </li>
          <li>
            <hr className="my-1 border-gray-200" />
          </li>
          <li
            className="px-4 py-2 hover:bg-red-100 text-red-700 cursor-pointer"
            onClick={handleRemoveBox}
          >
            {t("remove_box", "Diese Box entfernen")}
          </li>
        </ul>
      )}
      {/* Custom CSS to hide number input spin buttons */}
      <style>{`
      input.no-spinner::-webkit-outer-spin-button,
      input.no-spinner::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
      input.no-spinner {
        -moz-appearance: textfield;
      }
    `}</style>
    </div>
  );
});

export default PDFViewer;
