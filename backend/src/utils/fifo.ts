import db from '../db';

/**
 * Section 8: FIFO Inventory Valuation.
 *
 * receiveStock(): called from GRN posting. Creates a new cost layer and
 * bumps the denormalized stock balance.
 *
 * consumeStock(): called from Material Issue / Transfers / Adjustments.
 * Consumes the oldest layers first (First-In, First-Out) and returns the
 * weighted cost of the consumption, matching the spec's worked example:
 *   Purchase: 100 @ $10, 200 @ $12 -> Issue 150 -> consumes 100 @ $10 + 50 @ $12
 */

export function receiveStock(params: {
  item_id: number;
  warehouse_id: number;
  location_id?: number | null;
  quantity: number;
  unit_cost: number;
  batch?: string | null;
  expiry_date?: string | null;
  source_grn_item_id?: number | null;
  transaction_type?: string;
  reference_number?: string | null;
  reference_table?: string | null;
  reference_id?: number | null;
  created_by?: number | null;
}) {
  const { item_id, warehouse_id, location_id, quantity, unit_cost, batch, expiry_date, source_grn_item_id } = params;
  if(location_id){const location=db.prepare(`SELECT l.*,i.category FROM locations l CROSS JOIN items i WHERE l.id=? AND l.warehouse_id=? AND i.id=? AND l.deleted_at IS NULL`).get(location_id,warehouse_id,item_id) as any;if(!location)throw new Error('Storage BIN does not belong to the transaction warehouse');if(['Full','Blocked','Maintenance','Inactive'].includes(location.status))throw new Error(`BIN ${location.code} is ${location.status}`);const current=(db.prepare('SELECT COALESCE(SUM(quantity),0) qty FROM inventory_stock WHERE location_id=?').get(location_id) as any).qty;if(location.max_quantity!=null&&Number(current)+quantity>Number(location.max_quantity))throw new Error(`BIN ${location.code} capacity exceeded. Available capacity: ${Math.max(0,Number(location.max_quantity)-Number(current))}`);if(location.allowed_category&&location.category!==location.allowed_category)throw new Error(`BIN ${location.code} only permits category ${location.allowed_category}`);if(location.restricted_category&&location.category===location.restricted_category)throw new Error(`Category ${location.category} is restricted from BIN ${location.code}`);}

  db.prepare(
    `INSERT INTO inventory_layers (item_id, warehouse_id, location_id, batch, expiry_date, quantity_remaining, unit_cost, source_grn_item_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(item_id, warehouse_id, location_id ?? null, batch ?? null, expiry_date ?? null, quantity, unit_cost, source_grn_item_id ?? null);

  const existing = db
    .prepare(`SELECT id, quantity FROM inventory_stock WHERE item_id = ? AND warehouse_id = ? AND location_id IS ?`)
    .get(item_id, warehouse_id, location_id ?? null) as any;

  if (existing) {
    db.prepare('UPDATE inventory_stock SET quantity = quantity + ? WHERE id = ?').run(quantity, existing.id);
  } else {
    db.prepare(
      'INSERT INTO inventory_stock (item_id, warehouse_id, location_id, quantity) VALUES (?, ?, ?, ?)'
    ).run(item_id, warehouse_id, location_id ?? null, quantity);
  }
  db.prepare(`INSERT INTO stock_ledger (transaction_type,item_id,warehouse_id,location_id,quantity_change,unit_cost,reference_number,reference_table,reference_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(params.transaction_type || 'RECEIPT', item_id, warehouse_id, location_id ?? null, quantity, unit_cost, params.reference_number ?? null, params.reference_table ?? null, params.reference_id ?? null, params.created_by ?? null);
}

export function consumeStock(params: { item_id: number; warehouse_id: number; location_id?: number | null; quantity: number; transaction_type?: string; reference_number?: string | null; reference_table?: string | null; reference_id?: number | null; created_by?: number | null }): {
  totalCost: number;
  breakdown: { layer_id: number; quantity: number; unit_cost: number }[];
} {
  const { item_id, warehouse_id, location_id, quantity } = params;
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Issue quantity must be greater than zero');
  }
  let remainingToConsume = quantity;
  let totalCost = 0;
  const breakdown: { layer_id: number; quantity: number; unit_cost: number }[] = [];

  const rule=(db.prepare(`SELECT picking_rule FROM item_warehouse_settings WHERE item_id=? AND warehouse_id=?`).get(item_id,warehouse_id) as any)?.picking_rule||'FIFO';
  const layers = db
    .prepare(
      `SELECT id, quantity_remaining, unit_cost FROM inventory_layers
       WHERE item_id = ? AND warehouse_id = ? AND location_id IS ? AND quantity_remaining > 0
       ORDER BY ${rule==='FEFO' ? "CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date ASC," : ''} received_date ASC, id ASC`
    )
    .all(item_id, warehouse_id, location_id ?? null) as any[];

  const availableTotal = layers.reduce((sum, l) => sum + l.quantity_remaining, 0);
  if (availableTotal < quantity) {
    throw new Error(
      `Insufficient stock: requested ${quantity}, available ${availableTotal} for item ${item_id} at the selected storage location`
    );
  }

  for (const layer of layers) {
    if (remainingToConsume <= 0) break;
    const take = Math.min(layer.quantity_remaining, remainingToConsume);
    db.prepare('UPDATE inventory_layers SET quantity_remaining = quantity_remaining - ? WHERE id = ?').run(take, layer.id);
    totalCost += take * layer.unit_cost;
    breakdown.push({ layer_id: layer.id, quantity: take, unit_cost: layer.unit_cost });
    db.prepare(`INSERT INTO stock_ledger (transaction_type,item_id,warehouse_id,location_id,quantity_change,unit_cost,inventory_layer_id,reference_number,reference_table,reference_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(params.transaction_type || 'ISSUE', item_id, warehouse_id, location_id ?? null, -take, layer.unit_cost, layer.id, params.reference_number ?? null, params.reference_table ?? null, params.reference_id ?? null, params.created_by ?? null);
    remainingToConsume -= take;
  }

  const stockRow = db
    .prepare('SELECT id FROM inventory_stock WHERE item_id = ? AND warehouse_id = ? AND location_id IS ?')
    .get(item_id, warehouse_id, location_id ?? null) as any;
  if (stockRow) {
    db.prepare('UPDATE inventory_stock SET quantity = quantity - ? WHERE id = ?').run(quantity, stockRow.id);
  }

  return { totalCost, breakdown };
}

export function currentValuation(item_id: number, warehouse_id?: number) {
  const rows = db
    .prepare(
      `SELECT * FROM inventory_layers
       WHERE item_id = ? AND quantity_remaining > 0 ${warehouse_id ? 'AND warehouse_id = ?' : ''}
       ORDER BY received_date ASC, id ASC`
    )
    .all(...(warehouse_id ? [item_id, warehouse_id] : [item_id])) as any[];

  const totalQty = rows.reduce((s, r) => s + r.quantity_remaining, 0);
  const totalValue = rows.reduce((s, r) => s + r.quantity_remaining * r.unit_cost, 0);
  return { totalQty, totalValue, layers: rows };
}
