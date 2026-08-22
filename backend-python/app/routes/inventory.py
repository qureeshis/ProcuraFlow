from datetime import datetime,timezone
from fastapi import APIRouter,Depends,HTTPException
from ..audit import log_audit
from ..database import fetch_all,fetch_one,transaction
from ..security import User,roles

router=APIRouter(prefix='/api/inventory',tags=['inventory']); INV=['SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper']
def valuation(item_id):
    layers=fetch_all('SELECT * FROM inventory_layers WHERE item_id=? AND quantity_remaining>0 ORDER BY received_date,id',(item_id,));return {'totalQty':sum(r['quantity_remaining'] for r in layers),'totalValue':sum(r['quantity_remaining']*r['unit_cost'] for r in layers),'layers':layers}
def scoped(user,warehouse_id):
    if warehouse_id not in user['warehouse_ids']:raise HTTPException(403,'This employee is not assigned to the selected warehouse')
    if not fetch_one('SELECT id FROM warehouses WHERE id=? AND deleted_at IS NULL',(warehouse_id,)):raise HTTPException(409,'The selected warehouse is inactive; its operational workflow is disabled')
def approval_history(kind,row_id):return fetch_all('''SELECT al.*,u1.full_name requested_by_name,u2.full_name decision_by_name,e1.signature_url requested_by_signature_url,e2.signature_url decision_by_signature_url FROM approval_log al LEFT JOIN users u1 ON u1.id=al.requested_by LEFT JOIN users u2 ON u2.id=al.decision_by LEFT JOIN employees e1 ON e1.id=u1.employee_id LEFT JOIN employees e2 ON e2.id=u2.employee_id WHERE al.document_type=? AND al.document_id=? ORDER BY al.sequence,al.id''',(kind,row_id))

@router.get('/stock')
def stock(user:dict=Depends(roles(*INV))):
    ids=user['warehouse_ids'];
    if not ids:return []
    return fetch_all(f'''SELECT s.*,i.item_code,i.description,i.uom,w.name warehouse_name,w.warehouse_code,w.site_type,w.site_name,w.address warehouse_address,w.city warehouse_city,l.code location_code,l.type location_type,l.label location_label,l.status location_status,l.max_quantity,COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r WHERE r.item_id=s.item_id AND r.warehouse_id=s.warehouse_id AND r.location_id=s.location_id AND r.status='Active'),0) reserved_quantity,s.quantity-COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r WHERE r.item_id=s.item_id AND r.warehouse_id=s.warehouse_id AND r.location_id=s.location_id AND r.status='Active'),0) available_quantity FROM inventory_stock s JOIN items i ON i.id=s.item_id JOIN warehouses w ON w.id=s.warehouse_id LEFT JOIN locations l ON l.id=s.location_id WHERE s.quantity>0 AND s.warehouse_id IN({','.join('?' for _ in ids)}) ORDER BY i.item_code''',ids)
@router.get('/valuation')
def valuations(_user:dict=Depends(roles(*INV))):
    out=[]
    for item in fetch_all('SELECT * FROM items WHERE deleted_at IS NULL'):
        v=valuation(item['id']);out.append({'item_id':item['id'],'item_code':item['item_code'],'description':item['description'],'quantity':v['totalQty'],'value':round(v['totalValue'],2),'avg_unit_cost':round(v['totalValue']/v['totalQty'],2) if v['totalQty'] else 0})
    return out
@router.get('/valuation/{item_id}/layers')
def layers(item_id:int,_user:dict=Depends(roles(*INV))):return valuation(item_id)
@router.get('/expiry')
def expiry(_user:dict=Depends(roles(*INV))):
    rows=fetch_all("SELECT il.*,i.item_code,i.description,CAST(julianday(il.expiry_date)-julianday('now') AS INTEGER) days_remaining FROM inventory_layers il JOIN items i ON i.id=il.item_id WHERE il.quantity_remaining>0 AND il.expiry_date IS NOT NULL ORDER BY il.expiry_date")
    for r in rows:r['alert']='Expired' if r['days_remaining']<0 else '30-day' if r['days_remaining']<=30 else '60-day' if r['days_remaining']<=60 else '90-day' if r['days_remaining']<=90 else None
    return rows
@router.get('/abc-classification')
def abc(_user:dict=Depends(roles(*INV))):
    rows=[]
    for i in fetch_all('SELECT * FROM items WHERE deleted_at IS NULL'):rows.append({'item_id':i['id'],'item_code':i['item_code'],'description':i['description'],'value':valuation(i['id'])['totalValue']})
    rows.sort(key=lambda x:x['value'],reverse=True);total=sum(r['value'] for r in rows) or 1;cumulative=0
    for r in rows:cumulative+=r['value'];pct=cumulative/total;r.update(cumulative_pct=round(pct*100,1),classification='A' if pct<=.8 else 'B' if pct<=.95 else 'C')
    return rows
@router.get('/dead-stock')
def dead(_user:dict=Depends(roles(*INV))):
    rows=fetch_all('''SELECT i.id item_id,i.item_code,i.description,s.quantity,(SELECT MAX(d) FROM(SELECT MAX(grn_date)d FROM grns g JOIN grn_items gi ON gi.grn_id=g.id WHERE gi.item_id=i.id UNION SELECT MAX(issue_date) FROM material_issues mi JOIN material_issue_items mii ON mii.issue_id=mi.id WHERE mii.item_id=i.id UNION SELECT MAX(transfer_date) FROM transfers WHERE item_id=i.id))last_movement FROM items i JOIN inventory_stock s ON s.item_id=i.id AND s.quantity>0 WHERE i.deleted_at IS NULL''');out=[]
    for r in rows:
        days=(datetime.now(timezone.utc)-datetime.fromisoformat(r['last_movement']).replace(tzinfo=timezone.utc)).days if r['last_movement'] else None;bucket='Never Moved' if days is None else '365+ days' if days>=365 else '180+ days' if days>=180 else '90+ days' if days>=90 else None
        if bucket:r.update(days_since_movement=days,bucket=bucket);out.append(r)
    return out
@router.get('/cycle-counts')
def counts(user:User):
    ids=user['warehouse_ids'];return fetch_all(f"SELECT cc.*,w.name warehouse_name FROM cycle_counts cc JOIN warehouses w ON w.id=cc.warehouse_id WHERE cc.warehouse_id IN({','.join('?' for _ in ids) or 'NULL'}) ORDER BY cc.id DESC",ids)
@router.post('/cycle-counts',status_code=201)
def create_count(body:dict,user:dict=Depends(roles('WarehouseManager','WarehouseSupervisor'))):
    wid=body.get('warehouse_id');items=body.get('item_ids')
    if not isinstance(wid,int):raise HTTPException(400,'A valid warehouse is required')
    scoped(user,wid)
    if not isinstance(items,list) or not items:raise HTTPException(400,'Select at least one item')
    if len(set(items))!=len(items) or any(not isinstance(i,int) for i in items):raise HTTPException(400,'Item selection contains invalid or duplicate values')
    with transaction(immediate=True) as c:
        year=str((c.execute('SELECT financial_year FROM company ORDER BY id DESC LIMIT 1').fetchone() or {'financial_year':datetime.now().year})['financial_year']);import re;years=re.findall(r'\d{4}',year);year=years[-1] if years else str(datetime.now().year);row=c.execute("SELECT last_number FROM numbering_counters WHERE doc_type='CYCLECOUNT' AND year=?",(year,)).fetchone();seq=(row['last_number'] if row else 0)+1;c.execute("INSERT INTO numbering_counters(doc_type,year,last_number) VALUES('CYCLECOUNT',?,?) ON CONFLICT(doc_type,year) DO UPDATE SET last_number=excluded.last_number",(year,seq));number=f'CC-{year}-{seq:06d}';cur=c.execute('INSERT INTO cycle_counts(count_number,warehouse_id,created_by)VALUES(?,?,?)',(number,wid,user['id']))
        for item in items:c.execute('INSERT INTO cycle_count_items(count_id,item_id,system_qty)VALUES(?,?,COALESCE((SELECT SUM(quantity) FROM inventory_stock WHERE item_id=? AND warehouse_id=?),0))',(cur.lastrowid,item,item,wid))
        log_audit(c,'cycle_counts',cur.lastrowid,'CREATE',user['id'],after=body);count_id=cur.lastrowid
    return {'id':count_id,'count_number':number}
@router.get('/cycle-counts/{count_id}')
def count(count_id:int,user:User):
    row=fetch_one('SELECT * FROM cycle_counts WHERE id=?',(count_id,));
    if not row:raise HTTPException(404,'Cycle count not found')
    scoped(user,row['warehouse_id']);row['items']=fetch_all('SELECT cci.*,i.item_code,i.description FROM cycle_count_items cci JOIN items i ON i.id=cci.item_id WHERE cci.count_id=?',(count_id,));return row
@router.put('/cycle-counts/{count_id}/submit-counts')
def submit(count_id:int,body:dict,user:dict=Depends(roles('WarehouseSupervisor','Storekeeper'))):
    row=fetch_one('SELECT * FROM cycle_counts WHERE id=?',(count_id,));
    if not row:raise HTTPException(404,'Cycle count not found')
    scoped(user,row['warehouse_id']);counts=body.get('counts')
    if not isinstance(counts,list) or not counts:raise HTTPException(400,'At least one count is required')
    with transaction(immediate=True) as c:
        for value in counts:c.execute('UPDATE cycle_count_items SET counted_qty=?,variance=?-system_qty WHERE count_id=? AND item_id=?',(value['counted_qty'],value['counted_qty'],count_id,value['item_id']))
        c.execute("UPDATE cycle_counts SET status='Counted' WHERE id=?",(count_id,))
    return {'success':True}
@router.put('/cycle-counts/{count_id}/approve')
def approve(count_id:int,user:dict=Depends(roles('WarehouseManager','SupplyChainManager'))):
    row=fetch_one('SELECT * FROM cycle_counts WHERE id=?',(count_id,));
    if not row:raise HTTPException(404,'Not found')
    scoped(user,row['warehouse_id'])
    if row['status']!='Counted':raise HTTPException(409,f"Cycle count is {row['status']} and cannot be approved")
    if row.get('created_by')==user['id']and user['role']!='SupplyChainManager':raise HTTPException(403,'Segregation of duties: only the Supply Chain Manager may approve their own cycle count')
    with transaction(immediate=True) as c:c.execute("UPDATE cycle_counts SET status='Approved' WHERE id=?",(count_id,));c.execute("INSERT INTO approval_log(document_type,document_id,decision,decision_by,decision_date)VALUES('CYCLECOUNT',?,'Approved',?,datetime('now'))",(count_id,user['id']));log_audit(c,'cycle_counts',count_id,'APPROVE',user['id'])
    return {'success':True}
@router.get('/cycle-counts/{count_id}/approval-history')
def history(count_id:int,user:User):return approval_history('CYCLECOUNT',count_id)
