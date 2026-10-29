export function safeCsvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^\s*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function renderCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [columns.map(safeCsvCell).join(',')];
  for (const row of rows) lines.push(columns.map((column) => safeCsvCell(row[column])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
