from fastapi import APIRouter, Depends, HTTPException

from ..audit import log_audit
from ..crud import crud_router
from ..database import fetch_all, fetch_one, transaction
from ..security import User, roles

router=APIRouter(prefix='/api/advanced',tags=['advanced'])
TOOL_ROLES=['SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper']

@router.get('/tools')
def tools(user:dict=Depends(roles(*TOOL_ROLES))):
    ids=user['warehouse_ids'];return fetch_all(f"SELECT t.*,i.item_code,i.description item_description,w.name warehouse_name FROM tools t JOIN items i ON i.id=t.item_id JOIN warehouses w ON w.id=t.warehouse_id WHERE t.warehouse_id IN({','.join('?'for _ in ids)or'NULL'})ORDER BY t.tool_code",ids)

@router.get('/tools/alerts/calibration')
def calibration(user:dict=Depends(roles(*TOOL_ROLES))):
    ids=user['warehouse_ids']
    if not ids:return []
    return fetch_all(f"SELECT *,CAST(julianday(calibration_due_date)-julianday('now') AS INTEGER) days_remaining FROM tools WHERE calibration_due_date IS NOT NULL AND warehouse_id IN({','.join('?' for _ in ids)}) ORDER BY calibration_due_date",ids)

@router.get('/tools/{tool_id}')
def tool(tool_id:int,user:dict=Depends(roles(*TOOL_ROLES))):
    row=fetch_one(f"SELECT t.*,i.item_code,i.description item_description,w.name warehouse_name FROM tools t JOIN items i ON i.id=t.item_id JOIN warehouses w ON w.id=t.warehouse_id WHERE t.id=?AND t.warehouse_id IN({','.join('?'for _ in user['warehouse_ids'])or'NULL'})",(tool_id,*user['warehouse_ids']))
    if not row:raise HTTPException(404,'Tool not found')
    return row

@router.post('/tools',status_code=201)
def register_tool(body:dict,user:dict=Depends(roles(*TOOL_ROLES))):
    wid=body.get('warehouse_id');item=fetch_one("SELECT id,description FROM items WHERE id=?AND deleted_at IS NULL AND consumable_returnable='Returnable'",(body.get('item_id'),));warehouse=fetch_one('SELECT id,name FROM warehouses WHERE id=?AND deleted_at IS NULL',(wid,))
    if not item:raise HTTPException(400,'Linked item must be an active returnable item')
    if not warehouse or wid not in user['warehouse_ids']:raise HTTPException(403,'Select an authorized warehouse')
    serial=str(body.get('serial_number')or'').strip()
    if not serial:raise HTTPException(400,'Serial number is required')
    with transaction(immediate=True)as c:
        if c.execute('SELECT 1 FROM tools WHERE lower(serial_number)=lower(?)',(serial,)).fetchone():raise HTTPException(409,'A tool with this serial number already exists')
        sequence=c.execute('SELECT COUNT(*)count FROM tools WHERE warehouse_id=?',(wid,)).fetchone()['count']+1;code=f"{warehouse['name']} {sequence:05d}";cursor=c.execute("INSERT INTO tools(tool_code,serial_number,make,model,item_id,condition,calibration_due_date,warehouse_id)VALUES(?,?,?,?,?,'Good',?,?)",(code,serial,body.get('make'),body.get('model'),item['id'],body.get('calibration_due_date'),wid));log_audit(c,'tools',cursor.lastrowid,'CREATE',user['id'],after={**body,'tool_code':code,'item_description':item['description']});tool_id=cursor.lastrowid
    return tool(tool_id,user)

@router.put('/tools/{tool_id}/checkout')
def checkout(tool_id:int,body:dict,user:dict=Depends(roles(*TOOL_ROLES))):
    employee_id=body.get('employee_id')
    if not isinstance(employee_id,int):raise HTTPException(400,'A valid employee is required')
    tool=fetch_one('SELECT * FROM tools WHERE id=?',(tool_id,))
    if not tool:raise HTTPException(404,'Tool not found')
    if tool.get('employee_id') and not tool.get('return_date'):raise HTTPException(409,'Tool is already checked out')
    with transaction(immediate=True) as connection:
        connection.execute("UPDATE tools SET employee_id=?,issue_date=date('now'),return_date=NULL WHERE id=?",(employee_id,tool_id));log_audit(connection,'tools',tool_id,'UPDATE',user['id'],after={'employee_id':employee_id,'action':'checkout'})
    return {'success':True}

@router.put('/tools/{tool_id}/checkin')
def checkin(tool_id:int,body:dict,user:dict=Depends(roles(*TOOL_ROLES))):
    tool=fetch_one('SELECT * FROM tools WHERE id=?',(tool_id,));condition=body.get('condition')
    if not tool:raise HTTPException(404,'Tool not found')
    if not tool.get('employee_id') or tool.get('return_date'):raise HTTPException(409,'Tool is not currently checked out')
    if condition not in ['Good','Damaged','Needs Repair']:raise HTTPException(400,'Select a valid condition')
    with transaction(immediate=True) as connection:connection.execute("UPDATE tools SET return_date=date('now'),condition=? WHERE id=?",(condition,tool_id));log_audit(connection,'tools',tool_id,'UPDATE',user['id'],after={'condition':condition,'action':'checkin'})
    return {'success':True}

@router.get('/vendor-scorecards')
def scorecards(_user:dict=Depends(roles('SupplyChainManager','PurchaseManager'))):
    return fetch_all("""SELECT s.id supplier_id,s.name supplier_name,strftime('%Y-%m','now') period,
      ROUND(CASE WHEN COUNT(DISTINCT g.id)=0 THEN 0 ELSE 5.0*SUM(CASE WHEN po.committed_delivery_date IS NULL OR date(g.grn_date)<=date(po.committed_delivery_date) THEN 1 ELSE 0 END)/COUNT(DISTINCT g.id) END,2) delivery_accuracy,
      NULL price_competitiveness,
      ROUND(CASE WHEN COALESCE(SUM(gi.quantity_received),0)=0 THEN 0 ELSE 5.0*SUM(gi.accepted_qty)/SUM(gi.quantity_received) END,2) quality,
      NULL response_time,
      ROUND(CASE WHEN COUNT(DISTINCT po.id)=0 THEN 0 ELSE 5.0*COUNT(DISTINCT g.id)/COUNT(DISTINCT po.id) END,2) reliability,
      ROUND(CASE WHEN COALESCE(SUM(gi.quantity_received),0)=0 OR COUNT(DISTINCT g.id)=0 THEN COALESCE(s.rating,0)
        ELSE (0.30*(5.0*SUM(CASE WHEN po.committed_delivery_date IS NULL OR date(g.grn_date)<=date(po.committed_delivery_date) THEN 1 ELSE 0 END)/COUNT(DISTINCT g.id)))+(0.70*(5.0*SUM(gi.accepted_qty)/SUM(gi.quantity_received))) END,2) overall_score,
      COUNT(DISTINCT po.id) purchase_orders,COUNT(DISTINCT g.id) receipts,COALESCE(SUM(gi.rejected_qty),0) rejected_quantity
      FROM suppliers s LEFT JOIN purchase_orders po ON po.supplier_id=s.id
      LEFT JOIN grns g ON g.po_id=po.id LEFT JOIN grn_items gi ON gi.grn_id=g.id
      WHERE s.deleted_at IS NULL GROUP BY s.id,s.name,s.rating ORDER BY overall_score DESC,s.name""")

@router.post('/vendor-scorecards',status_code=201)
def create_scorecard(body:dict,user:dict=Depends(roles('PurchaseManager','SupplyChainManager'))):
    raise HTTPException(405,'Vendor scorecards are calculated automatically from PO and GRN performance')
    if not isinstance(body.get('supplier_id'),int) or not str(body.get('period') or '').strip():raise HTTPException(400,'Supplier and period are required')
    fields=['delivery_accuracy','price_competitiveness','quality','response_time','reliability'];values=[body.get(k) for k in fields]
    if any(v is not None and (not isinstance(v,(int,float)) or v<0 or v>5) for v in values):raise HTTPException(400,'Scores must be between 0 and 5')
    scores=[float(v) for v in values if v is not None];overall=sum(scores)/len(scores) if scores else 0
    with transaction(immediate=True) as connection:
        cursor=connection.execute(f"INSERT INTO vendor_scorecards(supplier_id,period,{','.join(fields)},overall_score) VALUES({','.join('?' for _ in range(8))})",(body['supplier_id'],body['period'],*values,overall));log_audit(connection,'vendor_scorecards',cursor.lastrowid,'CREATE',user['id'],after=body)
    return {'id':cursor.lastrowid,'overall_score':overall}
