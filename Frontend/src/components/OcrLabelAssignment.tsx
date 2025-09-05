import React, { Suspense, lazy } from "react";
import { Trash2 } from "lucide-react";
const FloatingSelect = lazy(() =>
  import("@schlayer-consulting/sc-base-frontend").then((m) => ({
    default: m.FloatingSelect,
  }))
);

const labelColors = {
  Titel: "#0ea5e9",
  Komponist: "#22c55e",
  Arrangeur: "#eab308",
  Stimme: "#8b5cf6",
  Genre: "#ec4899",
};

type LabelKeys = "Titel" | "Komponist" | "Arrangeur" | "Stimme" | "Genre";
type Labels = Partial<Record<LabelKeys, number>>; // Label → Box-Index
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

interface OcrLabelAssignmentProps {
  boxes: Box[];
  labels: Labels;
  setLabels: (labels: Labels) => void;
  t: any;
}

const OcrLabelAssignment: React.FC<OcrLabelAssignmentProps> = ({
  boxes,
  labels,
  setLabels,
  t,
}) => {
  const getValidDropdownValue = (key: LabelKeys) => {
    const idx = labels[key];
    return typeof idx === "number" && boxes[idx] ? String(idx) : "";
  };
  const handleLabelChange = (key: LabelKeys, idxStr: string) => {
    if (idxStr === "") {
      // Auswahl löschen, wenn leerer String (X-Button)
      const newLabels = { ...labels };
      delete newLabels[key];
      setLabels(newLabels);
      return;
    }
    const idx = parseInt(idxStr, 10);
    if (!isNaN(idx) && boxes[idx]) {
      setLabels({ ...labels, [key]: idx });
    }
  };
  const clearLabel = (key: LabelKeys) => {
    const newLabels = { ...labels };
    delete newLabels[key];
    setLabels(newLabels);
  };
  return (
    <div className="flex-1 text-sm">
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-0">
        {Object.keys(labelColors).map((key) => (
          <li key={key} className="mb-0 min-h-[42px]">
            <div className="relative w-64">
              <span
                className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-l"
                style={{
                  backgroundColor: labelColors[key as LabelKeys],
                  zIndex: 10,
                }}
              />
              <div className="pl-3">
                <Suspense fallback={<div />}>
                  <FloatingSelect
                    label={t(key, key)}
                    value={getValidDropdownValue(key as LabelKeys)}
                    onChange={(value) => {
                      if (typeof value === "string")
                        handleLabelChange(key as LabelKeys, value);
                    }}
                    options={boxes.map((box, idx) => ({
                      value: String(idx),
                      label: box.text,
                    }))}
                    clearable={true}
                  />
                </Suspense>
              </div>
            </div>
            {/* X-Icon zum Löschen ist jetzt im FloatingSelect integriert (clearable) */}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default OcrLabelAssignment;
