import db from '../db';

/**
 * Section 7.8: Numbering Master.
 * Produces sequential, year-scoped document numbers like PO-2026-000001,
 * matching the spec's format instead of timestamp-based IDs.
 */
const PREFIXES: Record<string, string> = {
  PR: 'PR',
  RFQ: 'RFQ',
  PO: 'PO',
  GRN: 'GRN',
  ISSUE: 'GIN',
  RETURN: 'ERN',
  TRANSFER: 'STN',
  ADJUSTMENT: 'ADJ',
  CYCLECOUNT: 'CC',
  MAR: 'MAR',
  FINPACK: 'FVP',
};

export function nextDocNumber(docType: keyof typeof PREFIXES): string {
 return db.transaction(() => {
  const company = db.prepare('SELECT financial_year FROM company ORDER BY id DESC LIMIT 1').get() as { financial_year?: string } | undefined;
  const fiscalMatch = String(company?.financial_year || '').match(/\d{4}/g);
  const year = fiscalMatch?.slice(-1)[0] || String(new Date().getFullYear());
  const prefix = PREFIXES[docType] || docType;

  const existing = db.prepare('SELECT last_number FROM numbering_counters WHERE doc_type = ? AND year = ?').get(docType, year) as
    | { last_number: number }
    | undefined;

  const next = (existing?.last_number ?? 0) + 1;

  if (existing) {
    db.prepare('UPDATE numbering_counters SET last_number = ? WHERE doc_type = ? AND year = ?').run(next, docType, year);
  } else {
    db.prepare('INSERT INTO numbering_counters (doc_type, year, last_number) VALUES (?, ?, ?)').run(docType, year, next);
  }

  return `${prefix}-${year}-${String(next).padStart(6, '0')}`;
 }).immediate();
}
