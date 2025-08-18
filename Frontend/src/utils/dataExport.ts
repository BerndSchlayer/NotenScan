// Utility-Funktionen für Datenexport (CSV, Excel, JSON)
import * as XLSX from "xlsx";

export interface ExportColumn {
  key: string;
  label: string;
  type?: string;
  lookup?: {
    data: any[];
    valueField: string;
    displayField: string;
  };
}
export function exportToCSV({
  rows,
  columns,
  selectedColumns,
  filename = 'export.csv',
  delimiter = ';',
  encoding = 'utf-8-bom',
  includeHeaders = true,
  formatJaNein,
  t,
}: {
  rows: any[];
  columns: ExportColumn[];
  selectedColumns: string[];
  filename?: string;
  delimiter?: string;
  encoding?: string;
  includeHeaders?: boolean;
  formatJaNein?: (val: boolean, t: any) => string;
  t?: any;
}) {
  // Daten vorbereiten
  const dataToExport = rows.map(row => {
    return selectedColumns.map(colKey => {
      let value = row[colKey];
      const col = columns.find(c => c.key === colKey);
      if (col?.lookup) {
        const item = col.lookup.data.find((d: any) => d[col.lookup!.valueField] === value);
        value = item ? item[col.lookup.displayField] : "";
      } else if (typeof value === "boolean" && formatJaNein && t) {
        value = formatJaNein(value, t);
      }
      return value ?? '';
    });
  });
  // Header
  const header = selectedColumns.map(colKey => {
    const col = columns.find(c => c.key === colKey);
    return col?.label ?? colKey;
  });
  const rowsArr: string[] = [];
  if (includeHeaders) rowsArr.push(header.map(h => `"${h.replace(/"/g, '""')}"`).join(delimiter));
  dataToExport.forEach(rowArr => {
    rowsArr.push(rowArr.map(val => `"${val.toString().replace(/"/g, '""')}"`).join(delimiter));
  });
  let csvContent = rowsArr.join('\r\n');
  // Encoding
  let blob: Blob;
  if (encoding === 'utf-8-bom') {
    const BOM = '\uFEFF';
    blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  } else if (encoding === 'windows-1252') {
    blob = new Blob([csvContent], { type: 'text/csv;charset=windows-1252;' });
  } else {
    blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportToExcel({
  rows,
  columns,
  selectedColumns,
  filename = 'export.xlsx',
  includeHeaders = true,
  formatJaNein,
  t,
}: {
  rows: any[];
  columns: ExportColumn[];
  selectedColumns: string[];
  filename?: string;
  includeHeaders?: boolean;
  formatJaNein?: (val: boolean, t: any) => string;
  t?: any;
}) {
  // Daten für Excel vorbereiten (Array of Arrays)
  const header = selectedColumns.map(colKey => {
    const col = columns.find(c => c.key === colKey);
    return col?.label ?? colKey;
  });
  const dataToExport = rows.map(row => {
    return selectedColumns.map(colKey => {
      let value = row[colKey];
      const col = columns.find(c => c.key === colKey);
      if (col?.lookup) {
        const item = col.lookup.data.find((d: any) => d[col.lookup!.valueField] === value);
        value = item ? item[col.lookup.displayField] : "";
      } else if (typeof value === "boolean" && formatJaNein && t) {
        value = formatJaNein(value, t);
      }
      // Behandlung für reines Datum (date)
      else if (
        col?.type === "date" && value &&
        (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value))
      ) {
        // Wert als echtes Date-Objekt übergeben
        const dateObj = new Date(value);
        if (!isNaN(dateObj.getTime())) {
          // Nur Datum, Zeit auf 00:00:00 setzen
          dateObj.setHours(0, 0, 0, 0);
          value = dateObj;
        }
      }
      // Behandlung für Datum mit Uhrzeit (datetime)
      else if (
        col?.type === "datetime" && value &&
        (typeof value === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(value))
      ) {
        const dateObj = new Date(value);
        if (!isNaN(dateObj.getTime())) {
          value = dateObj;
        }
      }
      return value ?? '';
    });
  });
  const sheetData = includeHeaders ? [header, ...dataToExport] : dataToExport;
  // Sheet erzeugen
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Daten");
  // Datei generieren
  const xlsxBlob = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([xlsxBlob], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportToJSON({
  rows,
  selectedColumns,
  filename = 'export.json',
}: {
  rows: any[];
  selectedColumns: string[];
  filename?: string;
}) {
  // Nur die ausgewählten Spalten exportieren
  const filteredRows = rows.map(row => {
    const obj: any = {};
    selectedColumns.forEach(colKey => {
      obj[colKey] = row[colKey];
    });
    return obj;
  });
  const jsonStr = JSON.stringify(filteredRows, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
