// =========================================================
// backup-helpers.js
// =========================================================
// Helpers compartidos por export/import. No conocen Supabase ni estado.
// =========================================================

export function backupFileStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function backupTypeLabel(type) {
  return {
    logs: 'Logs',
    tierlist: 'Tierlist',
    all: 'Backup completo',
    full_backup: 'Backup completo',
  }[type] || type || 'Exportación';
}

export function auditDetails(parts) {
  return parts.filter(Boolean).join(', ');
}

export function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
