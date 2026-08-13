import fs from 'fs';
import path from 'path';
import db from './index';
import * as XLSX from 'xlsx';

type Balance = { item_id:number; warehouse_id:number; location_id:number|null; stock_quantity:number; layer_quantity:number };

async function main() {
  const backupDir=path.join(__dirname,'../../backups');
  fs.mkdirSync(backupDir,{recursive:true});
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const backupPath=path.join(backupDir,`procuraflow-pre-inventory-repair-${stamp}.db`);
  await db.backup(backupPath);

  const mismatches=db.prepare(`WITH stock AS (
      SELECT item_id,warehouse_id,location_id,SUM(quantity) stock_quantity FROM inventory_stock GROUP BY item_id,warehouse_id,location_id
    ), layers AS (
      SELECT item_id,warehouse_id,location_id,SUM(quantity_remaining) layer_quantity FROM inventory_layers GROUP BY item_id,warehouse_id,location_id
    ), balance_keys AS (
      SELECT item_id,warehouse_id,location_id FROM stock UNION SELECT item_id,warehouse_id,location_id FROM layers
    ) SELECT k.item_id,k.warehouse_id,k.location_id,COALESCE(s.stock_quantity,0) stock_quantity,COALESCE(l.layer_quantity,0) layer_quantity
      FROM balance_keys k LEFT JOIN stock s ON s.item_id=k.item_id AND s.warehouse_id=k.warehouse_id AND s.location_id IS k.location_id
      LEFT JOIN layers l ON l.item_id=k.item_id AND l.warehouse_id=k.warehouse_id AND l.location_id IS k.location_id
      WHERE ABS(COALESCE(s.stock_quantity,0)-COALESCE(l.layer_quantity,0))>.0001`).all() as Balance[];

  let removedLayers=0;
  let adjustedLayers=0;
  let normalizedDates=0;
  let closedFullyReceivedOrders=0;
  const repair=db.transaction(()=>{
    for(const balance of mismatches){
      let excess=balance.layer_quantity-balance.stock_quantity;
      if(excess<=0.0001) continue;
      const candidates=db.prepare(`SELECT l.id,l.quantity_remaining FROM inventory_layers l
        LEFT JOIN stock_ledger sl ON sl.inventory_layer_id=l.id
        WHERE l.item_id=? AND l.warehouse_id=? AND l.location_id IS ? AND l.source_grn_item_id IS NULL AND sl.id IS NULL
        ORDER BY l.id`).all(balance.item_id,balance.warehouse_id,balance.location_id) as Array<{id:number;quantity_remaining:number}>;
      for(const layer of candidates){
        if(excess<=0.0001) break;
        if(layer.quantity_remaining<=excess+0.0001){db.prepare('DELETE FROM inventory_layers WHERE id=?').run(layer.id);excess-=layer.quantity_remaining;removedLayers+=1;}
        else {db.prepare('UPDATE inventory_layers SET quantity_remaining=quantity_remaining-? WHERE id=?').run(excess,layer.id);excess=0;adjustedLayers+=1;}
      }
      if(excess>0.0001) throw new Error(`Cannot safely reconcile item ${balance.item_id}, warehouse ${balance.warehouse_id}, location ${balance.location_id ?? 'unassigned'}; mismatch includes controlled transaction layers.`);
    }
    const datedLayers=db.prepare(`SELECT id,expiry_date,received_date FROM inventory_layers
      WHERE (expiry_date GLOB '[0-9]*.[0-9]*') OR (received_date GLOB '[0-9]*.[0-9]*')`).all() as Array<{id:number;expiry_date:string|null;received_date:string}>;
    const iso=(value:string|null)=>{if(!value||!/^\d+(?:\.\d+)?$/.test(value))return value;const parsed=XLSX.SSF.parse_date_code(Number(value));return parsed?`${parsed.y}-${String(parsed.m).padStart(2,'0')}-${String(parsed.d).padStart(2,'0')}`:value;};
    for(const layer of datedLayers){db.prepare('UPDATE inventory_layers SET expiry_date=?,received_date=? WHERE id=?').run(iso(layer.expiry_date),iso(layer.received_date),layer.id);normalizedDates+=1;}
    const fullyReceived=db.prepare(`SELECT po.id,po.status FROM purchase_orders po
      WHERE po.status IN ('Approved','Printed') AND EXISTS(SELECT 1 FROM po_items WHERE po_id=po.id)
      AND NOT EXISTS(SELECT 1 FROM po_items pi WHERE pi.po_id=po.id AND COALESCE((SELECT SUM(gi.accepted_qty) FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.po_id=po.id AND gi.item_id=pi.item_id),0)<pi.quantity-.0001)`).all() as Array<{id:number;status:string}>;
    for(const order of fullyReceived){
      db.prepare("UPDATE purchase_orders SET status='Closed' WHERE id=?").run(order.id);
      db.prepare("INSERT INTO audit_log(table_name,record_id,action,changed_by,old_values,new_values) VALUES('purchase_orders',?,'UPDATE',NULL,?,?)").run(order.id,JSON.stringify({status:order.status}),JSON.stringify({status:'Closed',reason:'Fully received consistency repair'}));
      closedFullyReceivedOrders+=1;
    }
  });
  repair();
  console.log(JSON.stringify({backup:backupPath,mismatches:mismatches.length,removed_layers:removedLayers,adjusted_layers:adjustedLayers,normalized_dates:normalizedDates,closed_fully_received_orders:closedFullyReceivedOrders},null,2));
}

main().catch((error)=>{console.error(error);process.exitCode=1;});
