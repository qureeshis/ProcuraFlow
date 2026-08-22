from fastapi import APIRouter,Depends,HTTPException
from ..audit import log_audit
from ..approval_routing import approval_authorized,employee_for_user,route_approver
from ..database import fetch_all,fetch_one,transaction
from ..security import User,roles
from ..delegated_authority import active_delegation,record_delegated_use
from ..stock import receive,consume
from .inventory import approval_history
from .procurement import number
router=APIRouter(prefix='/api/warehouse',tags=['warehouse']);WH=['SupplyChainManager','WarehouseManager','WarehouseSupervisor','Storekeeper'];VIEW=WH
def refresh_supplier_rating(connection,supplier_id):
    totals=connection.execute('''SELECT COALESCE(SUM(gi.quantity_received),0) received,COALESCE(SUM(gi.accepted_qty),0) accepted
      FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.supplier_id=?''',(supplier_id,)).fetchone()
    delivery=connection.execute('''SELECT COUNT(*) deliveries,SUM(CASE WHEN po.committed_delivery_date IS NOT NULL AND date(g.grn_date)<=date(po.committed_delivery_date) THEN 1 ELSE 0 END) on_time
      FROM grns g JOIN purchase_orders po ON po.id=g.po_id WHERE g.supplier_id=? AND po.committed_delivery_date IS NOT NULL''',(supplier_id,)).fetchone()
    ordered=connection.execute('''SELECT COALESCE(SUM(pi.quantity),0) quantity FROM po_items pi JOIN purchase_orders po ON po.id=pi.po_id
      WHERE po.supplier_id=? AND EXISTS(SELECT 1 FROM grns g WHERE g.po_id=po.id)''',(supplier_id,)).fetchone()['quantity']
    received=float(totals['received']or 0);accepted=float(totals['accepted']or 0)
    if not received:rating=0
    else:
        quality=min(1,accepted/received);quantity=min(1,accepted/float(ordered or accepted or 1));timeliness=float(delivery['on_time']or 0)/float(delivery['deliveries']or 1)
        rating=round(5*(quality*.45+quantity*.25+timeliness*.30),2)
    connection.execute('UPDATE suppliers SET rating=? WHERE id=?',(rating,supplier_id));return rating
def scope(user,wid,authority=None):
    delegation=None if wid in user['warehouse_ids'] else active_delegation(user,authority,warehouse_id=wid)if authority else None
    if wid not in user['warehouse_ids']and not delegation:raise HTTPException(403,'This employee is not assigned to the selected warehouse and has no matching delegated authority')
    if not fetch_one('SELECT id FROM warehouses WHERE id=? AND deleted_at IS NULL',(wid,)):raise HTTPException(409,'The selected warehouse is inactive; its operational workflow is disabled')
    return delegation
def locations(wid,lid):
    if not fetch_one("SELECT id FROM locations WHERE id=? AND warehouse_id=? AND type='Bin' AND deleted_at IS NULL",(lid,wid)):raise HTTPException(400,'Select a valid physical Bin in the warehouse')
@router.get('/grns')
def grns(user:dict=Depends(roles(*VIEW))):
    ids=user['warehouse_ids'];return fetch_all(f"SELECT g.*,'Posted' status,s.name supplier_name,po.po_number,COALESCE((SELECT SUM(gi.accepted_qty*gi.unit_cost) FROM grn_items gi WHERE gi.grn_id=g.id),0) accepted_value,COALESCE(be.name,u.full_name) received_by_name,be.employee_code received_for_employee_code FROM grns g JOIN suppliers s ON s.id=g.supplier_id JOIN purchase_orders po ON po.id=g.po_id LEFT JOIN users u ON u.id=g.created_by LEFT JOIN employees be ON be.id=g.received_for_employee_id WHERE EXISTS(SELECT 1 FROM grn_items gi WHERE gi.grn_id=g.id AND gi.warehouse_id IN({','.join('?'for _ in ids)or'NULL'})) ORDER BY g.id DESC",ids)
@router.get('/grns/{grn_id}')
def grn(grn_id:int,user:dict=Depends(roles(*VIEW))):
    row=fetch_one("SELECT g.*,'Posted' status,s.name supplier_name,po.po_number,po.committed_delivery_date,po.total_amount po_total_amount,COALESCE(be.name,u.full_name) received_by_name,be.employee_code received_for_employee_code,COALESCE(be.signature_url,e.signature_url) received_by_signature_url FROM grns g JOIN suppliers s ON s.id=g.supplier_id JOIN purchase_orders po ON po.id=g.po_id LEFT JOIN users u ON u.id=g.created_by LEFT JOIN employees e ON e.id=u.employee_id LEFT JOIN employees be ON be.id=g.received_for_employee_id WHERE g.id=?",(grn_id,));
    if not row:raise HTTPException(404,'GRN not found')
    row['items']=fetch_all('SELECT gi.*,i.item_code,i.description,i.uom,i.purchase_uom,w.name warehouse_name,l.code location_code FROM grn_items gi JOIN items i ON i.id=gi.item_id JOIN warehouses w ON w.id=gi.warehouse_id LEFT JOIN locations l ON l.id=gi.location_id WHERE gi.grn_id=?',(grn_id,));
    if not row['items']:raise HTTPException(404,'GRN lines not found')
    scope(user,row['items'][0]['warehouse_id']);row['company']=fetch_one('SELECT * FROM company WHERE deleted_at IS NULL ORDER BY id LIMIT 1')or{};return row
@router.post('/grns',status_code=201)
def create_grn(body:dict,user:dict=Depends(roles(*WH))):
    items=body.get('items');employee_id=body.get('received_for_employee_id');wid=body.get('warehouse_id')or(user['warehouse_ids'][0]if len(user['warehouse_ids'])==1 else None);delegation=scope(user,wid,'WH_GRN_RECEIVE');employee=fetch_one("""SELECT e.id FROM employees e JOIN departments d ON d.id=e.department_id WHERE e.id=? AND e.status='Active' AND e.deleted_at IS NULL AND lower(d.name) LIKE '%warehouse%' AND(e.warehouse_id=? OR EXISTS(SELECT 1 FROM employee_warehouse_assignments a WHERE a.employee_id=e.id AND a.active_yn=1 AND(a.all_warehouses_yn=1 OR a.warehouse_id=?)))""",(employee_id,wid,wid))
    if not employee:raise HTTPException(400,'Select a valid active employee responsible for this receipt')
    if not isinstance(items,list)or not items:raise HTTPException(400,'At least one item required')
    po=fetch_one('SELECT * FROM purchase_orders WHERE id=?',(body.get('po_id'),));
    if not po:raise HTTPException(404,'PO not found')
    if po['status']not in['Approved','Printed']:raise HTTPException(400,'GRN can only be created against an approved PO')
    poitems={x['item_id']:x for x in fetch_all('SELECT * FROM po_items WHERE po_id=?',(po['id'],))}
    with transaction(immediate=True)as c:
        num=number(c,'GRN');cur=c.execute('INSERT INTO grns(grn_number,po_id,supplier_id,delivery_note,created_by,received_for_employee_id)VALUES(?,?,?,?,?,?)',(num,po['id'],po['supplier_id'],body.get('delivery_note'),user['id'],employee_id));accepted_total=0
        for x in items:
            if x.get('item_id')not in poitems:raise HTTPException(400,f"Item {x.get('item_id')} is not on this PO")
            accepted=float(x.get('accepted_qty',x.get('quantity_received',0)));rejected=float(x.get('rejected_qty',0));received_qty=float(x.get('quantity_received',0))
            if received_qty<0 or accepted<0 or rejected<0:raise HTTPException(400,'Received, accepted, and rejected quantities cannot be negative')
            if abs(accepted+rejected-received_qty)>.0001:raise HTTPException(400,'Accepted plus rejected must equal received')
            already_accepted=float((c.execute('SELECT COALESCE(SUM(gi.accepted_qty),0) accepted FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.po_id=? AND gi.item_id=?',(po['id'],x['item_id'])).fetchone()or{'accepted':0})['accepted'])
            outstanding=max(0,float(poitems[x['item_id']]['quantity'])-already_accepted)
            if accepted>outstanding+.0001:raise HTTPException(409,f"Accepted quantity exceeds the PO outstanding quantity of {outstanding:g}")
            if accepted:locations(wid,x.get('location_id'))
            price=float(poitems[x['item_id']]['price']);gi=c.execute('INSERT INTO grn_items(grn_id,item_id,quantity_received,accepted_qty,rejected_qty,rejection_reason,unit_cost,batch,expiry_date,warehouse_id,location_id)VALUES(?,?,?,?,?,?,?,?,?,?,?)',(cur.lastrowid,x['item_id'],received_qty,accepted,rejected,x.get('rejection_reason'),price,x.get('batch'),x.get('expiry_date'),wid,x.get('location_id')))
            if accepted:receive(c,item_id=x['item_id'],warehouse_id=wid,location_id=x.get('location_id'),quantity=accepted,unit_cost=price,batch=x.get('batch'),expiry_date=x.get('expiry_date'),source_grn_item_id=gi.lastrowid,transaction_type='GRN_RECEIPT',reference_number=num,reference_table='grns',reference_id=cur.lastrowid,created_by=user['id']);c.execute('UPDATE items SET last_purchase_price=? WHERE id=?',(price,x['item_id']));accepted_total+=accepted*price
        supplier_rating=refresh_supplier_rating(c,po['supplier_id']);delegated=record_delegated_use(c,delegation,user,'grns',cur.lastrowid,'CREATE',{'warehouse_id':wid})if delegation else{};log_audit(c,'grns',cur.lastrowid,'CREATE',user['id'],after={**body,'supplier_performance_rating':supplier_rating,**delegated});gid=cur.lastrowid
        incomplete=c.execute('SELECT 1 FROM po_items pi WHERE pi.po_id=? AND COALESCE((SELECT SUM(gi.accepted_qty)FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.po_id=pi.po_id AND gi.item_id=pi.item_id),0)<pi.quantity LIMIT 1',(po['id'],)).fetchone();c.execute("UPDATE purchase_orders SET status=? WHERE id=?",('Printed'if incomplete else'Closed',po['id']))
    return {'id':gid,'grn_number':num,'accepted_value':accepted_total}
@router.get('/returns')
def returns(user:dict=Depends(roles(*WH))):
    ids=user['warehouse_ids'];return fetch_all(f"SELECT r.*,i.item_code,i.description,e.name employee_name,w.name warehouse_name,l.code location_code FROM returns r JOIN items i ON i.id=r.item_id LEFT JOIN employees e ON e.id=r.employee_id LEFT JOIN warehouses w ON w.id=r.warehouse_id LEFT JOIN locations l ON l.id=r.location_id WHERE r.warehouse_id IN({','.join('?'for _ in ids)or'NULL'}) ORDER BY r.id DESC",ids)
@router.get('/material-issues')
def issues(user:dict=Depends(roles(*WH))):
    ids=user['warehouse_ids'];return fetch_all(f"SELECT mi.*,e.name employee_name,e.employee_code,d.name employee_department_name FROM material_issues mi JOIN employees e ON e.id=mi.employee_id LEFT JOIN departments d ON d.id=e.department_id WHERE EXISTS(SELECT 1 FROM material_issue_items mii WHERE mii.issue_id=mi.id AND mii.warehouse_id IN({','.join('?'for _ in ids)or'NULL'})) ORDER BY mi.id DESC",ids)
@router.get('/material-issues/{issue_id}')
def issue(issue_id:int,user:dict=Depends(roles(*WH))):
    row=fetch_one('SELECT mi.*,e.name employee_name,e.employee_code,d.name employee_department_name FROM material_issues mi JOIN employees e ON e.id=mi.employee_id LEFT JOIN departments d ON d.id=e.department_id WHERE mi.id=?',(issue_id,));
    if not row:raise HTTPException(404,'Material issue not found')
    row['items']=fetch_all('SELECT mii.*,i.item_code,i.description,w.name warehouse_name,l.code location_code FROM material_issue_items mii JOIN items i ON i.id=mii.item_id JOIN warehouses w ON w.id=mii.warehouse_id LEFT JOIN locations l ON l.id=mii.location_id WHERE mii.issue_id=?',(issue_id,));
    if not row['items']:raise HTTPException(404,'Material issue lines not found')
    scope(user,row['items'][0]['warehouse_id']);return row
@router.post('/material-issues',status_code=201)
def create_issue(body:dict,user:dict=Depends(roles(*WH))):
    items=body.get('items');
    employee=fetch_one("SELECT id FROM employees WHERE id=? AND status='Active' AND deleted_at IS NULL",(body.get('employee_id'),))
    if not employee:raise HTTPException(400,'Select a valid active employee receiving the material')
    if not isinstance(items,list)or not items:raise HTTPException(400,'At least one item required')
    masters=[]
    for x in items:
        scope(user,x.get('warehouse_id'),'WH_MATERIAL_ISSUE');locations(x.get('warehouse_id'),x.get('location_id'));master=fetch_one('SELECT * FROM items WHERE id=?',(x.get('item_id'),));
        if not master or not isinstance(x.get('quantity'),(int,float))or x['quantity']<=0:raise HTTPException(400,'Every issue line requires a valid item, warehouse, Bin, and positive quantity')
        masters.append((x,master))
    if len({x['warehouse_id']for x,_ in masters})!=1:raise HTTPException(400,'A Material Issue must contain items from one authorized warehouse')
    estimate=sum(x['quantity']*(m.get('standard_cost')or 0)for x,m in masters);wid=items[0]['warehouse_id'];requester=employee_for_user(user)
    if not requester:raise HTTPException(403,'An active Warehouse employee record is required')
    approver,limit,level,rule=route_approver(requester['id'],estimate,'ISSUE',wid);required=True;status='PendingApproval'
    with transaction(immediate=True)as c:
        num=number(c,'ISSUE');cur=c.execute('INSERT INTO material_issues(issue_number,employee_id,purpose,approval_required,status,created_by,total_value)VALUES(?,?,?,?,?,?,?)',(num,body.get('employee_id'),body.get('purpose'),int(required),status,user['id'],estimate));iid=cur.lastrowid
        for x,m in masters:
            if required:cost=x['quantity']*(m.get('standard_cost')or 0);used=[]
            else:cost,used=consume(c,item_id=x['item_id'],warehouse_id=x['warehouse_id'],location_id=x['location_id'],quantity=x['quantity'],transaction_type='MATERIAL_ISSUE',reference_number=num,reference_table='material_issues',reference_id=iid,created_by=user['id'])
            line=c.execute('INSERT INTO material_issue_items(issue_id,item_id,warehouse_id,location_id,quantity,value)VALUES(?,?,?,?,?,?)',(iid,x['item_id'],x['warehouse_id'],x['location_id'],x['quantity'],cost))
            for layer_id,qty,cost_each in used:c.execute('INSERT INTO material_issue_layer_usage(material_issue_item_id,inventory_layer_id,quantity,unit_cost)VALUES(?,?,?,?)',(line.lastrowid,layer_id,qty,cost_each))
        if required:c.execute("INSERT INTO approval_log(document_type,document_id,document_number,required_role,requested_by,decision,approval_value,approval_currency,approver_employee_id,approver_role,workflow_level,escalation_rule)VALUES('ISSUE',?,?,?,?,'Pending',?,'SAR',?,?,?,?)",(iid,num,approver['user_role'],user['id'],estimate,approver['id'],approver['user_role'],str(level),rule))
        log_audit(c,'material_issues',iid,'CREATE',user['id'],after=body)
    return {'id':iid,'issue_number':num,'status':status}
@router.put('/material-issues/{issue_id}/approve')
def approve_issue(issue_id:int,user:dict=Depends(roles(*WH))):
    row=fetch_one('SELECT * FROM material_issues WHERE id=?',(issue_id,));
    if not row:raise HTTPException(404,'Not found')
    if row['status']!='PendingApproval':raise HTTPException(400,'This issue is not pending approval')
    lines=fetch_all('SELECT * FROM material_issue_items WHERE issue_id=?',(issue_id,));wid=lines[0]['warehouse_id']if lines else None;scope(user,wid);pending=fetch_one("SELECT * FROM approval_log WHERE document_type='ISSUE'AND document_id=?AND decision='Pending' ORDER BY sequence,id LIMIT 1",(issue_id,))
    if not pending:raise HTTPException(409,'This Material Issue has no pending approval')
    employee,limit,authority=approval_authorized(user,row['created_by'],float(row.get('total_value')or pending.get('approval_value')or 0),'ISSUE',wid,pending);total=0
    with transaction(immediate=True)as c:
        for x in lines:
            cost,used=consume(c,item_id=x['item_id'],warehouse_id=x['warehouse_id'],location_id=x['location_id'],quantity=x['quantity'],transaction_type='MATERIAL_ISSUE',reference_number=row['issue_number'],reference_table='material_issues',reference_id=issue_id,created_by=user['id']);c.execute('UPDATE material_issue_items SET value=? WHERE id=?',(cost,x['id']));total+=cost
            for layer_id,qty,unit in used:c.execute('INSERT INTO material_issue_layer_usage(material_issue_item_id,inventory_layer_id,quantity,unit_cost)VALUES(?,?,?,?)',(x['id'],layer_id,qty,unit))
        c.execute("UPDATE material_issues SET status='Posted',approved_by=?,total_value=? WHERE id=?",(user['id'],total,issue_id));c.execute("UPDATE approval_log SET decision='Approved',decision_by=?,decision_date=datetime('now'),approval_limit_used=?,approval_limit_source=? WHERE id=?",(user['id'],limit,authority,pending['id']));log_audit(c,'material_issues',issue_id,'APPROVE',user['id'],row,{'authority':authority,'approval_limit':limit})
    return {'success':True}
@router.put('/material-issues/{issue_id}/reject')
def reject_issue(issue_id:int,user:dict=Depends(roles(*WH))):
    row=fetch_one('SELECT * FROM material_issues WHERE id=?',(issue_id,));
    if not row:raise HTTPException(404,'Not found')
    if row['status']!='PendingApproval':raise HTTPException(409,f"Issue is {row['status']} and can no longer be amended")
    lines=fetch_all('SELECT warehouse_id FROM material_issue_items WHERE issue_id=?',(issue_id,));wid=lines[0]['warehouse_id']if lines else None;scope(user,wid);pending=fetch_one("SELECT * FROM approval_log WHERE document_type='ISSUE'AND document_id=?AND decision='Pending' ORDER BY sequence,id LIMIT 1",(issue_id,))
    if not pending:raise HTTPException(409,'This Material Issue has no pending approval')
    approval_authorized(user,row['created_by'],float(row.get('total_value')or pending.get('approval_value')or 0),'ISSUE',wid,pending)
    with transaction(immediate=True)as c:c.execute("UPDATE material_issues SET status='Rejected' WHERE id=?",(issue_id,));c.execute("UPDATE approval_log SET decision='Rejected',decision_by=?,decision_date=datetime('now') WHERE document_type='ISSUE'AND document_id=?AND decision='Pending'",(user['id'],issue_id));log_audit(c,'material_issues',issue_id,'REJECT',user['id'])
    return {'success':True}
@router.get('/material-issues/{issue_id}/approval-history')
def issue_history(issue_id:int,_u:User):return approval_history('ISSUE',issue_id)
@router.post('/returns',status_code=201)
def create_return(body:dict,user:dict=Depends(roles(*WH))):
    wid=body.get('warehouse_id');scope(user,wid,'WH_MATERIAL_RETURN');locations(wid,body.get('location_id'));item=fetch_one('SELECT * FROM items WHERE id=?',(body.get('item_id'),));qty=body.get('quantity')
    if not item:raise HTTPException(404,'Item not found')
    if item['consumable_returnable']!='Returnable':raise HTTPException(400,'This item is Consumable and does not support returns')
    issued=fetch_one("""SELECT mii.value/NULLIF(mii.quantity,0) unit_cost FROM material_issue_items mii JOIN material_issues mi ON mi.id=mii.issue_id WHERE mi.employee_id=? AND mii.item_id=? AND mi.status='Posted' ORDER BY mi.id DESC,mii.id DESC LIMIT 1""",(body.get('employee_id'),item['id']));return_cost=float((issued or{}).get('unit_cost')or item.get('standard_cost')or 0)
    with transaction(immediate=True)as c:num=number(c,'RETURN');cur=c.execute('INSERT INTO returns(return_number,item_id,employee_id,quantity,condition,warehouse_id,location_id)VALUES(?,?,?,?,?,?,?)',(num,item['id'],body.get('employee_id'),qty,body.get('condition'),wid,body.get('location_id')));receive(c,item_id=item['id'],warehouse_id=wid,location_id=body.get('location_id'),quantity=qty,unit_cost=return_cost,transaction_type='RETURN',reference_number=num,reference_table='returns',reference_id=cur.lastrowid,created_by=user['id']);log_audit(c,'returns',cur.lastrowid,'CREATE',user['id'],after={**body,'unit_cost':return_cost});rid=cur.lastrowid
    return {'id':rid,'return_number':num}
@router.get('/transfers')
def transfers(user:User):
    ids=user['warehouse_ids'];return fetch_all(f"SELECT t.*,i.item_code,i.description,fw.name from_warehouse_name,tw.name to_warehouse_name,fl.code from_location_code,tl.code to_location_code,tr.receipt_number,du.full_name dispatched_by_name,de.signature_url dispatched_by_signature_url,ru.full_name received_by_name,re.signature_url received_by_signature_url FROM transfers t JOIN items i ON i.id=t.item_id LEFT JOIN warehouses fw ON fw.id=t.from_warehouse_id LEFT JOIN warehouses tw ON tw.id=t.to_warehouse_id LEFT JOIN locations fl ON fl.id=t.from_location_id LEFT JOIN locations tl ON tl.id=t.to_location_id LEFT JOIN transfer_receipts tr ON tr.transfer_id=t.id LEFT JOIN users du ON du.id=t.dispatched_by LEFT JOIN employees de ON de.id=du.employee_id LEFT JOIN users ru ON ru.id=t.received_by LEFT JOIN employees re ON re.id=ru.employee_id WHERE t.from_warehouse_id IN({','.join('?'for _ in ids)or'NULL'})OR t.to_warehouse_id IN({','.join('?'for _ in ids)or'NULL'}) ORDER BY t.id DESC",ids+ids)
@router.get('/bin-transfers')
def bin_transfers(user:dict=Depends(roles(*WH))):
    ids=user['warehouse_ids'];return fetch_all(f"SELECT bt.*,w.warehouse_code,w.name warehouse_name,i.item_code,i.description,fl.code from_bin,tl.code to_bin,u.full_name completed_by_name FROM bin_transfers bt JOIN warehouses w ON w.id=bt.warehouse_id JOIN items i ON i.id=bt.item_id JOIN locations fl ON fl.id=bt.from_location_id JOIN locations tl ON tl.id=bt.to_location_id LEFT JOIN users u ON u.id=bt.completed_by WHERE bt.warehouse_id IN({','.join('?'for _ in ids)or'NULL'}) ORDER BY bt.id DESC",ids)
@router.post('/bin-transfers',status_code=201)
def create_bin_transfer(body:dict,user:dict=Depends(roles(*WH))):
    wid=body.get('warehouse_id');qty=body.get('quantity');scope(user,wid);locations(wid,body.get('from_location_id'));locations(wid,body.get('to_location_id'))
    if body.get('from_location_id')==body.get('to_location_id'):raise HTTPException(400,'Source and destination BIN must be different')
    if not isinstance(qty,(int,float))or qty<=0 or not str(body.get('reason')or'').strip():raise HTTPException(400,'Item, positive quantity and transfer reason are required')
    with transaction(immediate=True)as c:num=number(c,'BINTRANSFER');cost,_=consume(c,item_id=body.get('item_id'),warehouse_id=wid,location_id=body.get('from_location_id'),quantity=qty,transaction_type='BIN_TRANSFER_OUT',reference_number=num,reference_table='bin_transfers',created_by=user['id']);receive(c,item_id=body.get('item_id'),warehouse_id=wid,location_id=body.get('to_location_id'),quantity=qty,unit_cost=cost/qty,transaction_type='BIN_TRANSFER_IN',reference_number=num,reference_table='bin_transfers',created_by=user['id']);cur=c.execute('INSERT INTO bin_transfers(transfer_number,warehouse_id,item_id,from_location_id,to_location_id,quantity,reason,completed_by)VALUES(?,?,?,?,?,?,?,?)',(num,wid,body.get('item_id'),body.get('from_location_id'),body.get('to_location_id'),qty,str(body['reason']).strip(),user['id']));log_audit(c,'bin_transfers',cur.lastrowid,'CREATE',user['id'],after=body);bid=cur.lastrowid
    return {'id':bid,'transfer_number':num}
@router.post('/transfers',status_code=201)
def create_transfer(body:dict,user:dict=Depends(roles(*WH))):
    fw=body.get('from_warehouse_id');scope(user,fw,'WH_TRANSFER');locations(fw,body.get('from_location_id'));locations(body.get('to_warehouse_id'),body.get('to_location_id'));qty=body.get('quantity')
    with transaction(immediate=True)as c:num=number(c,'TRANSFER');cost,_=consume(c,item_id=body.get('item_id'),warehouse_id=fw,location_id=body.get('from_location_id'),quantity=qty,transaction_type='TRANSFER_DISPATCH',reference_number=num,reference_table='transfers',created_by=user['id']);cur=c.execute("INSERT INTO transfers(transfer_number,item_id,quantity,from_warehouse_id,from_location_id,to_warehouse_id,to_location_id,transport_mode,vehicle_reference,driver_name,tracking_reference,remarks,status,dispatched_by,dispatched_at,unit_cost)VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'In Transit',?,datetime('now'),?)",(num,body.get('item_id'),qty,fw,body.get('from_location_id'),body.get('to_warehouse_id'),body.get('to_location_id'),body.get('transport_mode'),body.get('vehicle_reference'),body.get('driver_name'),body.get('tracking_reference'),body.get('remarks'),user['id'],cost/qty));tid=cur.lastrowid
    return {'id':tid,'transfer_number':num}
@router.put('/transfers/{transfer_id}/receive')
def receive_transfer(transfer_id:int,body:dict,user:dict=Depends(roles(*WH))):
    row=fetch_one("SELECT * FROM transfers WHERE id=?",(transfer_id,));
    if not row:raise HTTPException(404,'Transfer not found')
    if row['status']!='In Transit':raise HTTPException(409,f"Transfer is already {row['status']}")
    scope(user,row['to_warehouse_id']);lid=body.get('to_location_id')or row['to_location_id'];locations(row['to_warehouse_id'],lid);ref=str(body.get('receiving_reference')or f"TRR-{row['transfer_number']}")
    with transaction(immediate=True)as c:receive(c,item_id=row['item_id'],warehouse_id=row['to_warehouse_id'],location_id=lid,quantity=row['quantity'],unit_cost=row.get('unit_cost')or 0,transaction_type='TRANSFER_RECEIPT',reference_number=ref,reference_table='transfer_receipts',reference_id=row['id'],created_by=user['id']);c.execute('INSERT INTO transfer_receipts(receipt_number,transfer_id,warehouse_id,location_id,item_id,quantity_received,receiving_note,received_by)VALUES(?,?,?,?,?,?,?,?)',(ref,row['id'],row['to_warehouse_id'],lid,row['item_id'],row['quantity'],body.get('receiving_note'),user['id']));c.execute("UPDATE transfers SET status='Received',to_location_id=?,received_by=?,received_at=datetime('now'),receiving_reference=? WHERE id=?",(lid,user['id'],ref,row['id']))
    return {'success':True,'status':'Received','receipt_number':ref}
@router.get('/adjustments')
def adjustments(_u:User):return fetch_all('SELECT a.*,i.item_code,i.description,w.name warehouse_name,l.code location_code FROM stock_adjustments a JOIN items i ON i.id=a.item_id JOIN warehouses w ON w.id=a.warehouse_id LEFT JOIN locations l ON l.id=a.location_id ORDER BY a.id DESC')
@router.post('/adjustments',status_code=201)
def create_adjustment(body:dict,user:User):
    delegation=None if user['role']=='SupplyChainManager'else active_delegation(user,'WH_INVENTORY_ADJUST',warehouse_id=body.get('warehouse_id'))
    if user['role']!='SupplyChainManager'and not delegation:raise HTTPException(403,'Only the Supply Chain Manager or a matching active delegate may create this adjustment')
    scope(user,body.get('warehouse_id'),'WH_INVENTORY_ADJUST');locations(body.get('warehouse_id'),body.get('location_id'))
    with transaction(immediate=True)as c:num=number(c,'ADJUSTMENT');cur=c.execute("INSERT INTO stock_adjustments(adjustment_number,item_id,warehouse_id,location_id,quantity_change,reason,status,created_by)VALUES(?,?,?,?,?,?,'Pending',?)",(num,body.get('item_id'),body.get('warehouse_id'),body.get('location_id'),body.get('quantity_change'),body.get('reason'),user['id']));c.execute("INSERT INTO approval_log(document_type,document_id,document_number,required_role,requested_by,decision)VALUES('ADJUSTMENT',?,?, 'SupplyChainManager',?,'Pending')",(cur.lastrowid,num,user['id']));delegated=record_delegated_use(c,delegation,user,'stock_adjustments',cur.lastrowid,'CREATE',{'warehouse_id':body.get('warehouse_id')})if delegation else{};log_audit(c,'stock_adjustments',cur.lastrowid,'CREATE',user['id'],after={**body,**delegated});aid=cur.lastrowid
    return {'id':aid,'adjustment_number':num}
@router.put('/adjustments/{adjustment_id}/approve')
def approve_adjustment(adjustment_id:int,user:User):
    row=fetch_one('SELECT * FROM stock_adjustments WHERE id=?',(adjustment_id,));
    if not row:raise HTTPException(404,'Not found')
    delegation=None if user['role']=='SupplyChainManager'else active_delegation(user,'WH_INVENTORY_ADJUST_APPROVE','INVENTORY_ADJUSTMENT',adjustment_id,warehouse_id=row['warehouse_id'])
    if user['role']!='SupplyChainManager'and not delegation:raise HTTPException(403,'Only the Supply Chain Manager or a matching active delegate may approve this adjustment')
    if row['status']!='Pending':raise HTTPException(409,f"Adjustment is {row['status']} and cannot be approved again")
    with transaction(immediate=True)as c:
        if row['quantity_change']>0:receive(c,item_id=row['item_id'],warehouse_id=row['warehouse_id'],location_id=row['location_id'],quantity=row['quantity_change'],unit_cost=(fetch_one('SELECT standard_cost FROM items WHERE id=?',(row['item_id'],))or{}).get('standard_cost',0),transaction_type='ADJUSTMENT_IN',reference_number=row['adjustment_number'],reference_table='stock_adjustments',reference_id=row['id'],created_by=user['id'])
        else:consume(c,item_id=row['item_id'],warehouse_id=row['warehouse_id'],location_id=row['location_id'],quantity=-row['quantity_change'],transaction_type='ADJUSTMENT_OUT',reference_number=row['adjustment_number'],reference_table='stock_adjustments',reference_id=row['id'],created_by=user['id'])
        c.execute("UPDATE stock_adjustments SET status='Approved',approved_by=? WHERE id=?",(user['id'],row['id']));c.execute("UPDATE approval_log SET decision='Approved',decision_by=?,decision_date=datetime('now') WHERE document_type='ADJUSTMENT'AND document_id=?AND decision='Pending'",(user['id'],row['id']));delegated=record_delegated_use(c,delegation,user,'stock_adjustments',row['id'],'APPROVE',{'warehouse_id':row['warehouse_id']})if delegation else{};log_audit(c,'stock_adjustments',row['id'],'APPROVE',user['id'],row,{'self_approved':row.get('created_by')==user['id'],**delegated})
    return {'success':True}
@router.get('/adjustments/{row_id}/approval-history')
def adjustment_history(row_id:int,_u:User):return approval_history('ADJUSTMENT',row_id)
