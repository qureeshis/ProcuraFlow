import db from '../db';
import { nextDocNumber } from './numbering';
import { requestApproval } from './approvalLog';
import { logAudit } from './auditLog';

let running = false;

export function syncLowStockPurchaseRequisition() {
  if (running) return null;
  running = true;
  try {
    const requestor = db.prepare("SELECT id FROM users WHERE role='SupplyChainManager' AND is_active=1 AND deleted_at IS NULL ORDER BY id LIMIT 1").get() as any
      || db.prepare('SELECT id FROM users WHERE is_active=1 AND deleted_at IS NULL ORDER BY id LIMIT 1').get() as any;
    if (!requestor) return null;

    db.prepare("INSERT OR IGNORE INTO departments (name) VALUES ('Warehouse')").run();
    const department = db.prepare("SELECT id FROM departments WHERE name='Warehouse' AND deleted_at IS NULL LIMIT 1").get() as any;
    if (!department) return null;

    const candidates = db.prepare(`
      SELECT i.id item_id, i.item_code, i.description, i.reorder_level, i.max_stock,
             i.conversion_factor, i.purchase_uom, i.uom,
             COALESCE((SELECT SUM(s.quantity) FROM inventory_stock s WHERE s.item_id=i.id),0) on_hand
      FROM items i
      WHERE i.deleted_at IS NULL AND i.reorder_level > 0
        AND COALESCE((SELECT SUM(s.quantity) FROM inventory_stock s WHERE s.item_id=i.id),0) <= i.reorder_level
        AND NOT EXISTS (
          SELECT 1 FROM pr_items pri JOIN purchase_requisitions pr ON pr.id=pri.pr_id
          WHERE pri.item_id=i.id AND pr.status='Submitted'
        )
        AND NOT EXISTS (
          SELECT 1 FROM po_items poi JOIN purchase_orders po ON po.id=poi.po_id
          WHERE poi.item_id=i.id
            AND po.status IN ('PendingApproval','Approved','Printed','Closed')
            AND poi.quantity > COALESCE((SELECT SUM(gi.accepted_qty) FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.po_id=po.id AND gi.item_id=poi.item_id),0)
        )
      ORDER BY i.item_code
    `).all() as any[];
    if (!candidates.length) return null;

    return db.transaction(() => {
      const prNumber = nextDocNumber('PR');
      const result = db.prepare("INSERT INTO purchase_requisitions (pr_number,requestor_id,department_id,auto_generated,status) VALUES (?,NULL,?,?, 'Submitted')")
        .run(prNumber, department.id, 1);
      const prId = Number(result.lastInsertRowid);
      const insertLine = db.prepare('INSERT INTO pr_items (pr_id,item_id,quantity,required_date,reason) VALUES (?,?,?,?,?)');
      const lines = candidates.map((item) => {
        const targetBaseQty = Math.max(Number(item.max_stock || 0), Number(item.reorder_level || 0));
        const requiredBaseQty = Math.max(targetBaseQty - Number(item.on_hand || 0), 0);
        const factor = Math.max(Number(item.conversion_factor || 1), 0.000001);
        const quantity = Math.max(Math.ceil((requiredBaseQty / factor) * 1000) / 1000, 0.001);
        insertLine.run(prId, item.item_id, quantity, null, `Automatic low-stock replenishment: on hand ${item.on_hand}, reorder level ${item.reorder_level}, target ${targetBaseQty}`);
        return { item_id: item.item_id, quantity, on_hand: item.on_hand, target: targetBaseQty };
      });
      requestApproval({ document_type: 'PR', document_id: prId, document_number: prNumber, required_role: 'PurchaseManager' });
      logAudit('purchase_requisitions', prId, 'CREATE', requestor.id, undefined, { source: 'AUTO_LOW_STOCK', prNumber, lines });
      return { id: prId, pr_number: prNumber, item_count: lines.length };
    })();
  } finally {
    running = false;
  }
}
