from fastapi import HTTPException
def receive(c,*,item_id,warehouse_id,location_id,quantity,unit_cost,batch=None,expiry_date=None,received_date=None,transaction_type='RECEIPT',reference_number=None,reference_table=None,reference_id=None,created_by=None,source_grn_item_id=None):
    if quantity<=0:return
    c.execute('INSERT INTO inventory_layers(item_id,warehouse_id,location_id,batch,expiry_date,received_date,quantity_remaining,unit_cost,source_grn_item_id)VALUES(?,?,?,?,?,COALESCE(?,date(\'now\')),?,?,?)',(item_id,warehouse_id,location_id,batch,expiry_date,received_date,quantity,unit_cost,source_grn_item_id))
    row=c.execute('SELECT id FROM inventory_stock WHERE item_id=? AND warehouse_id=? AND location_id IS ?',(item_id,warehouse_id,location_id)).fetchone()
    if row:c.execute('UPDATE inventory_stock SET quantity=quantity+? WHERE id=?',(quantity,row['id']))
    else:c.execute('INSERT INTO inventory_stock(item_id,warehouse_id,location_id,quantity)VALUES(?,?,?,?)',(item_id,warehouse_id,location_id,quantity))
    c.execute('INSERT INTO stock_ledger(transaction_type,item_id,warehouse_id,location_id,quantity_change,unit_cost,reference_number,reference_table,reference_id,created_by)VALUES(?,?,?,?,?,?,?,?,?,?)',(transaction_type,item_id,warehouse_id,location_id,quantity,unit_cost,reference_number,reference_table,reference_id,created_by))
def consume(c,*,item_id,warehouse_id,location_id,quantity,transaction_type='ISSUE',reference_number=None,reference_table=None,reference_id=None,created_by=None):
    if quantity<=0:raise HTTPException(400,'Issue quantity must be greater than zero')
    layers=c.execute('SELECT id,quantity_remaining,unit_cost FROM inventory_layers WHERE item_id=? AND warehouse_id=? AND location_id IS ? AND quantity_remaining>0 ORDER BY received_date,id',(item_id,warehouse_id,location_id)).fetchall();available=sum(x['quantity_remaining']for x in layers)
    if available<quantity:raise HTTPException(400,f'Insufficient stock: requested {quantity}, available {available} for item {item_id} at the selected storage location')
    left=quantity;cost=0;used=[]
    for layer in layers:
        if left<=0:break
        take=min(layer['quantity_remaining'],left);c.execute('UPDATE inventory_layers SET quantity_remaining=quantity_remaining-? WHERE id=?',(take,layer['id']));c.execute('INSERT INTO stock_ledger(transaction_type,item_id,warehouse_id,location_id,quantity_change,unit_cost,inventory_layer_id,reference_number,reference_table,reference_id,created_by)VALUES(?,?,?,?,?,?,?,?,?,?,?)',(transaction_type,item_id,warehouse_id,location_id,-take,layer['unit_cost'],layer['id'],reference_number,reference_table,reference_id,created_by));cost+=take*layer['unit_cost'];used.append((layer['id'],take,layer['unit_cost']));left-=take
    c.execute('UPDATE inventory_stock SET quantity=quantity-? WHERE item_id=? AND warehouse_id=? AND location_id IS ?',(quantity,item_id,warehouse_id,location_id));return cost,used
