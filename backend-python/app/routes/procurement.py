from datetime import datetime
from fastapi import APIRouter,Depends,HTTPException
from ..audit import log_audit
from ..approval_routing import approval_authorized,employee_for_user,route_approver
from ..database import fetch_all,fetch_one,transaction
from ..security import User,roles
from ..delegated_authority import active_delegation,record_delegated_use
from .inventory import approval_history
router=APIRouter(prefix='/api/procurement',tags=['procurement']);PROC=['SupplyChainManager','PurchaseManager','PurchaseOfficer'];ALL=PROC+['WarehouseManager','WarehouseSupervisor','Storekeeper']
PREFIX={'PR':'PR','RFQ':'RFQ','PO':'PO','MAR':'MAR','FINPACK':'FVP','GRN':'GRN','ISSUE':'GIN','RETURN':'ERN','TRANSFER':'STN','ADJUSTMENT':'ADJ','CYCLECOUNT':'CC','BINTRANSFER':'BT'}
def number(c,kind):
    company=c.execute('SELECT financial_year FROM company ORDER BY id DESC LIMIT 1').fetchone();import re;ys=re.findall(r'\d{4}',str(company['financial_year'] if company else ''));year=ys[-1] if ys else str(datetime.now().year);row=c.execute('SELECT last_number FROM numbering_counters WHERE doc_type=? AND year=?',(kind,year)).fetchone();seq=(row['last_number'] if row else 0)+1;c.execute('INSERT INTO numbering_counters(doc_type,year,last_number)VALUES(?,?,?) ON CONFLICT(doc_type,year)DO UPDATE SET last_number=excluded.last_number',(kind,year,seq));return f'{PREFIX[kind]}-{year}-{seq:06d}'
def detail(kind,row_id):
    table,idcol,itemtable,fk={'PR':('purchase_requisitions','pr_number','pr_items','pr_id'),'PO':('purchase_orders','po_number','po_items','po_id')}[kind];row=fetch_one(f'''SELECT d.*,u.full_name created_by_name,e.signature_url created_by_signature_url
        FROM {table} d LEFT JOIN users u ON u.id=d.{'requestor_id' if kind=='PR' else 'created_by'}
        LEFT JOIN employees e ON e.id=u.employee_id WHERE d.id=?''',(row_id,));
    if not row:raise HTTPException(404,'Not found')
    if kind=='PO':
        row['items']=fetch_all('''SELECT x.*,i.item_code,i.description,i.uom,i.purchase_uom,i.issue_uom,
          COALESCE((SELECT SUM(gi.accepted_qty) FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.po_id=x.po_id AND gi.item_id=x.item_id),0) received_qty,
          MAX(0,x.quantity-COALESCE((SELECT SUM(gi.accepted_qty) FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.po_id=x.po_id AND gi.item_id=x.item_id),0)) outstanding_qty,
          (SELECT sl.location_id FROM stock_ledger sl WHERE sl.item_id=x.item_id AND sl.location_id IS NOT NULL ORDER BY sl.id DESC LIMIT 1) last_location_id,
          (SELECT l.code FROM stock_ledger sl JOIN locations l ON l.id=sl.location_id WHERE sl.item_id=x.item_id ORDER BY sl.id DESC LIMIT 1) last_location_code
          FROM po_items x JOIN items i ON i.id=x.item_id WHERE x.po_id=?''',(row_id,))
    else:row['items']=fetch_all('''SELECT x.*,i.item_code,i.description,i.uom,i.purchase_uom,i.issue_uom,
      COALESCE((SELECT SUM(a.quantity) FROM po_pr_item_allocations a JOIN purchase_orders po ON po.id=a.po_id WHERE a.pr_item_id=x.id AND po.status NOT IN('Rejected')),0) ordered_quantity,
      MAX(0,x.quantity-COALESCE((SELECT SUM(a.quantity) FROM po_pr_item_allocations a JOIN purchase_orders po ON po.id=a.po_id WHERE a.pr_item_id=x.id AND po.status NOT IN('Rejected')),0)) remaining_quantity,
      CASE WHEN COALESCE((SELECT SUM(a.quantity) FROM po_pr_item_allocations a JOIN purchase_orders po ON po.id=a.po_id WHERE a.pr_item_id=x.id AND po.status NOT IN('Rejected')),0)<=0 THEN 'Open' WHEN COALESCE((SELECT SUM(a.quantity) FROM po_pr_item_allocations a JOIN purchase_orders po ON po.id=a.po_id WHERE a.pr_item_id=x.id AND po.status NOT IN('Rejected')),0)<x.quantity THEN 'Partially Ordered' ELSE 'Fully Ordered' END order_status
      FROM pr_items x JOIN items i ON i.id=x.item_id WHERE x.pr_id=?''',(row_id,))
    return row
def validate_lines(items,priced=False):
    if not isinstance(items,list) or not items:raise HTTPException(400,'At least one item required')
    if any(not isinstance(x.get('item_id'),int) or not isinstance(x.get('quantity'),(int,float)) or x['quantity']<=0 or(priced and(not isinstance(x.get('price'),(int,float))or x['price']<0)) for x in items):raise HTTPException(400,'Every line requires a valid item and positive quantity')

RFQ_TERMINAL={'Cancelled','Closed'}
def require_rfq(rfq_id,allowed=None):
    row=fetch_one('SELECT * FROM rfqs WHERE id=?',(rfq_id,))
    if not row:raise HTTPException(404,'RFQ not found')
    if allowed and row.get('workflow_status')not in allowed:raise HTTPException(409,f"RFQ is {row.get('workflow_status')} and this action is not permitted")
    return row
def nonnegative(body,key,required=False):
    value=body.get(key)
    if value in(None,'')and not required:return 0.0
    try:value=float(value)
    except(TypeError,ValueError):raise HTTPException(400,f'{key.replace("_"," ").title()} must be numeric')
    if value<0 or(required and value<=0):raise HTTPException(400,f'{key.replace("_"," ").title()} must be {"greater than zero"if required else"zero or greater"}')
    return value

def refresh_pr_order_status(connection,pr_id,user_id,related_po_id):
    pr=connection.execute('SELECT * FROM purchase_requisitions WHERE id=?',(pr_id,)).fetchone()
    if not pr or pr['closed_manually']:return
    open_line=connection.execute("""SELECT 1 FROM pr_items x WHERE x.pr_id=? AND COALESCE((SELECT SUM(a.quantity) FROM po_pr_item_allocations a JOIN purchase_orders po ON po.id=a.po_id WHERE a.pr_item_id=x.id AND po.status NOT IN('Rejected')),0)<x.quantity LIMIT 1""",(pr_id,)).fetchone()
    new_status='Submitted'if open_line else'Closed'
    if pr['status']!=new_status:
        connection.execute('UPDATE purchase_requisitions SET status=? WHERE id=?',(new_status,pr_id));log_audit(connection,'purchase_requisitions',pr_id,'UPDATE',user_id,before={'status':pr['status']},after={'status':new_status,'related_po_id':related_po_id,'workflow_action':'AUTO_ORDER_STATUS'})

@router.get('/prs')
def prs(_u:User):return fetch_all("SELECT pr.*,d.name department_name,CASE WHEN pr.auto_generated=1 THEN 'ProcuraFlow' ELSE COALESCE(be.name,u.full_name) END requestor_name,be.employee_code requestor_employee_code,(SELECT al.decision FROM approval_log al WHERE al.document_type='PR' AND al.document_id=pr.id ORDER BY al.id DESC LIMIT 1)approval_decision,COALESCE((SELECT po_id FROM po_pr_links WHERE pr_id=pr.id LIMIT 1),(SELECT id FROM purchase_orders WHERE pr_id=pr.id LIMIT 1))converted_po_id FROM purchase_requisitions pr LEFT JOIN departments d ON d.id=pr.department_id LEFT JOIN users u ON u.id=pr.requestor_id LEFT JOIN employees be ON be.id=pr.business_requestor_employee_id ORDER BY pr.id DESC")
@router.get('/prs/{pr_id}')
def get_pr(pr_id:int,_u:User):
    row=detail('PR',pr_id);business=fetch_one('SELECT e.name,e.employee_code,e.signature_url,d.name department_name FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE e.id=?',(row.get('business_requestor_employee_id'),))or{};row['requestor_name']=business.get('name')or row.get('created_by_name');row['requestor_employee_code']=business.get('employee_code');row['requestor_signature_url']=business.get('signature_url')or row.get('created_by_signature_url');row['company']=fetch_one('SELECT * FROM company WHERE deleted_at IS NULL ORDER BY id LIMIT 1')or{};row['approvals']=approval_history('PR',pr_id);return row
@router.post('/prs',status_code=201)
def create_pr(body:dict,user:dict=Depends(roles(*ALL))):
    items=body.get('items');validate_lines(items);employee_id=body.get('requestor_employee_id');employee=fetch_one('SELECT id,department_id FROM employees WHERE id=? AND status=\'Active\' AND deleted_at IS NULL',(employee_id,));dept=body.get('department_id')or(employee or{}).get('department_id')
    if not employee:raise HTTPException(400,'Select a valid active requesting employee')
    if not isinstance(dept,int):raise HTTPException(400,'A valid department is required')
    value=round(sum(float(x['quantity'])*float((fetch_one('SELECT standard_cost FROM items WHERE id=?',(x['item_id'],))or{}).get('standard_cost')or 0)for x in items),2);requester=employee_for_user(user)
    if not requester:raise HTTPException(403,'An active Supply Chain employee record is required')
    approver,limit,level,rule=route_approver(requester['id'],value,'PR')
    currency=(fetch_one('SELECT COALESCE(base_currency,currency,\'SAR\') currency FROM company WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1')or{}).get('currency')or'SAR'
    with transaction(immediate=True) as c:
        num=number(c,'PR');cur=c.execute("INSERT INTO purchase_requisitions(pr_number,requestor_id,business_requestor_employee_id,department_id,status)VALUES(?,?,?,?,'Submitted')",(num,user['id'],employee_id,dept))
        for x in items:c.execute('INSERT INTO pr_items(pr_id,item_id,quantity,required_date,reason)VALUES(?,?,?,?,?)',(cur.lastrowid,x['item_id'],x['quantity'],x.get('required_date'),x.get('reason')))
        c.execute("INSERT INTO approval_log(document_type,document_id,document_number,required_role,requested_by,decision,approval_value,approval_currency,approver_employee_id,approver_role,workflow_level,escalation_rule)VALUES('PR',?,?,?,?, 'Pending',?,?,?,?,?,?)",(cur.lastrowid,num,approver['user_role'],user['id'],value,currency,approver['id'],approver['user_role'],str(level),rule));log_audit(c,'purchase_requisitions',cur.lastrowid,'CREATE',user['id'],after={**body,'approval_value':value,'routed_approver_employee_id':approver['id'],'routing_rule':rule});row_id=cur.lastrowid
    return {'id':row_id,'pr_number':num}
@router.put('/prs/{pr_id}')
def edit_pr(pr_id:int,body:dict,user:dict=Depends(roles('SupplyChainManager'))):
    row=fetch_one('SELECT * FROM purchase_requisitions WHERE id=?',(pr_id,));validate_lines(body.get('items'))
    if not row:raise HTTPException(404,'PR not found')
    if row['status']!='Submitted':raise HTTPException(409,f"PR is {row['status']} and cannot be edited")
    employee=fetch_one("SELECT id,department_id FROM employees WHERE id=? AND status='Active' AND deleted_at IS NULL",(body.get('requestor_employee_id'),))
    if not employee:raise HTTPException(400,'Select a valid active requesting employee')
    dept=body.get('department_id')or employee['department_id']
    with transaction(immediate=True) as c:c.execute('UPDATE purchase_requisitions SET department_id=?,business_requestor_employee_id=? WHERE id=?',(dept,employee['id'],pr_id));c.execute('DELETE FROM pr_items WHERE pr_id=?',(pr_id,));[c.execute('INSERT INTO pr_items(pr_id,item_id,quantity,required_date,reason)VALUES(?,?,?,?,?)',(pr_id,x['item_id'],x['quantity'],x.get('required_date'),x.get('reason')))for x in body['items']];log_audit(c,'purchase_requisitions',pr_id,'UPDATE',user['id'],row,body)
    return {'success':True}
@router.put('/prs/{pr_id}/status')
def pr_status(pr_id:int,body:dict,user:dict=Depends(roles(*ALL))):
    decision=body.get('status');row=fetch_one('SELECT * FROM purchase_requisitions WHERE id=?',(pr_id,))
    if decision not in ['Approved','Rejected','Closed']:raise HTTPException(400,'Invalid status')
    if not row:raise HTTPException(404,'Not found')
    pending=fetch_one("SELECT * FROM approval_log WHERE document_type='PR' AND document_id=? AND decision='Pending' ORDER BY sequence,id LIMIT 1",(pr_id,))
    delegation=None;limit=None;authority='Normal Role'
    if decision in ['Approved','Rejected']:
        if not pending:raise HTTPException(409,'This PR has no pending approval decision')
        delegation=active_delegation(user,'PROC_PR_PROCESS','PR',pr_id)
        try:employee,limit,authority=approval_authorized(user,row['requestor_id'],float(pending.get('approval_value')or 0),'PR',pending=pending)
        except HTTPException:
            if not delegation:raise
            employee,limit,authority=None,None,'Delegated Authority'
    status='Submitted' if decision=='Approved' else decision
    with transaction(immediate=True) as c:c.execute('UPDATE purchase_requisitions SET status=?,closed_manually=? WHERE id=?',(status,int(decision=='Closed'),pr_id));c.execute("UPDATE approval_log SET decision=?,decision_by=?,decision_date=datetime('now'),approval_limit_used=?,approval_limit_source=? WHERE id=(SELECT id FROM approval_log WHERE document_type='PR' AND document_id=? AND decision='Pending' ORDER BY sequence LIMIT 1)",(decision,user['id'],limit,authority,pr_id));delegated=record_delegated_use(c,delegation,user,'purchase_requisitions',pr_id,decision.upper())if decision in['Approved','Rejected']and delegation else{};log_audit(c,'purchase_requisitions',pr_id,'APPROVE' if decision=='Approved' else 'REJECT',user['id'],after={'decision':decision,'authority':authority,'approval_limit':limit,**delegated})
    return {'success':True,'status':status}
@router.get('/prs/{pr_id}/approval-history')
def pr_history(pr_id:int,_u:User):return approval_history('PR',pr_id)

@router.get('/rfqs')
def rfqs(_u:dict=Depends(roles(*PROC))):return fetch_all("""SELECT r.*,pr.pr_number,(SELECT COUNT(*)FROM rfq_suppliers rs WHERE rs.rfq_id=r.id)suppliers_invited,(SELECT COUNT(*)FROM supplier_quotations q WHERE q.rfq_id=r.id)quotations_received FROM rfqs r LEFT JOIN purchase_requisitions pr ON pr.id=r.pr_id ORDER BY r.id DESC""")
@router.get('/quotations')
def quotation_register(_u:dict=Depends(roles(*PROC))):return fetch_all("""SELECT q.*,r.rfq_number,s.name supplier_name,i.item_code,i.description,(q.price*q.quoted_quantity-q.discount+q.freight+q.other_charges+(q.price*q.quoted_quantity*q.tax/100.0))evaluated_cost FROM supplier_quotations q JOIN rfqs r ON r.id=q.rfq_id JOIN suppliers s ON s.id=q.supplier_id JOIN items i ON i.id=q.item_id ORDER BY q.id DESC""")
@router.get('/rfq-awards')
def award_register(_u:dict=Depends(roles(*PROC))):return fetch_all("""SELECT a.*,r.rfq_number,s.name supplier_name,i.item_code,i.description,q.quotation_number,q.price,q.currency,po.po_number FROM rfq_awards a JOIN rfqs r ON r.id=a.rfq_id JOIN suppliers s ON s.id=a.supplier_id JOIN items i ON i.id=a.item_id JOIN supplier_quotations q ON q.id=a.quotation_id LEFT JOIN purchase_orders po ON po.id=a.po_id ORDER BY a.id DESC""")
@router.get('/rfqs/{rfq_id}')
def rfq_detail(rfq_id:int,_u:dict=Depends(roles(*PROC))):
    row=fetch_one('SELECT r.*,pr.pr_number FROM rfqs r LEFT JOIN purchase_requisitions pr ON pr.id=r.pr_id WHERE r.id=?',(rfq_id,))
    if not row:raise HTTPException(404,'RFQ not found')
    row['items']=fetch_all('SELECT pi.*,i.item_code,i.description,i.uom,i.purchase_uom FROM pr_items pi JOIN items i ON i.id=pi.item_id WHERE pi.pr_id=?',(row['pr_id'],)) if row.get('pr_id')else[]
    row['suppliers']=fetch_all('SELECT rs.*,s.supplier_code,s.name,s.rating,s.contact_person,s.email FROM rfq_suppliers rs JOIN suppliers s ON s.id=rs.supplier_id WHERE rs.rfq_id=?',(rfq_id,));return row
@router.post('/rfqs',status_code=201)
def create_rfq(body:dict,user:dict=Depends(roles('PurchaseOfficer','PurchaseManager','SupplyChainManager'))):
    suppliers=body.get('supplier_ids');
    if not isinstance(suppliers,list)or not suppliers:raise HTTPException(400,'Select at least one supplier')
    pr_id=body.get('pr_id');supplier_ids=list(dict.fromkeys(int(value)for value in suppliers if value))
    pr=fetch_one("SELECT * FROM purchase_requisitions WHERE id=? AND status='Submitted' AND EXISTS(SELECT 1 FROM approval_log WHERE document_type='PR'AND document_id=purchase_requisitions.id AND decision='Approved')",(pr_id,))
    if not pr:raise HTTPException(409,'RFQ must be linked to an approved PR with remaining quantities')
    if not fetch_one('SELECT 1 ok FROM pr_items x WHERE x.pr_id=? AND x.quantity>COALESCE((SELECT SUM(a.quantity)FROM po_pr_item_allocations a JOIN purchase_orders po ON po.id=a.po_id WHERE a.pr_item_id=x.id AND po.status NOT IN(\'Rejected\')),0) LIMIT 1',(pr_id,)):raise HTTPException(409,'This PR is fully ordered')
    with transaction(immediate=True)as c:
        if c.execute("SELECT 1 FROM rfqs WHERE pr_id=? AND workflow_status NOT IN('Cancelled','Closed')",(pr_id,)).fetchone():raise HTTPException(409,'An active RFQ already exists for this PR')
        valid={row['id']for row in c.execute("SELECT id FROM suppliers WHERE id IN(%s) AND deleted_at IS NULL AND active_yn=1 AND blocked_yn=0"%','.join('?'for _ in supplier_ids),supplier_ids).fetchall()}
        if valid!=set(supplier_ids):raise HTTPException(409,'Inactive, blocked, or unknown suppliers cannot be invited')
        num=number(c,'RFQ');cur=c.execute("""INSERT INTO rfqs(rfq_number,pr_id,workflow_status,issue_date,closing_date,required_delivery_date,delivery_warehouse_id,delivery_location_id,currency,payment_terms,incoterms,contact_person,notes,commercial_terms,technical_requirements,created_by)VALUES(?,?,'Draft',?,?,?,?,?,?,?,?,?,?,?,?,?)""",(num,pr_id,body.get('issue_date'),body.get('closing_date'),body.get('required_delivery_date'),body.get('delivery_warehouse_id'),None,body.get('currency'),body.get('payment_terms'),body.get('incoterms'),body.get('contact_person'),body.get('notes'),body.get('commercial_terms'),body.get('technical_requirements'),user['id']));[c.execute('INSERT INTO rfq_suppliers(rfq_id,supplier_id,contact_person,email)SELECT ?,id,contact_person,email FROM suppliers WHERE id=?',(cur.lastrowid,s))for s in supplier_ids];log_audit(c,'rfqs',cur.lastrowid,'CREATE',user['id'],after={**body,'supplier_ids':supplier_ids});rid=cur.lastrowid
    return {'id':rid,'rfq_number':num}
@router.post('/rfqs/{rfq_id}/quotations',status_code=201)
def quote(rfq_id:int,body:dict,_u:dict=Depends(roles('PurchaseOfficer','PurchaseManager','SupplyChainManager'))):
    rfq=require_rfq(rfq_id,{'Issued','Quotations Pending','Quotations Received'})
    if rfq.get('closing_date') and str(rfq['closing_date'])<datetime.now().date().isoformat():raise HTTPException(409,'The RFQ quotation closing date has passed')
    if not fetch_one('SELECT id FROM rfq_suppliers WHERE rfq_id=? AND supplier_id=?',(rfq_id,body.get('supplier_id'))):raise HTTPException(400,'Supplier was not invited to this RFQ')
    lines=body.get('items') if isinstance(body.get('items'),list) else [body]
    if not lines:raise HTTPException(400,'Select at least one RFQ item')
    if len({line.get('item_id')for line in lines})!=len(lines):raise HTTPException(400,'Each RFQ item may appear only once in a quotation')
    if body.get('validity_date')and body.get('quotation_date')and body['validity_date']<body['quotation_date']:raise HTTPException(400,'Quotation validity date cannot precede quotation date')
    prepared=[]
    for line in lines:
        item_id=line.get('item_id')
        if not fetch_one('SELECT 1 ok FROM rfqs r JOIN pr_items pi ON pi.pr_id=r.pr_id WHERE r.id=?AND pi.item_id=?',(rfq_id,item_id)):raise HTTPException(400,'A quoted item is not included in the linked PR')
        price=nonnegative(line,'price',True);quantity=nonnegative(line,'quoted_quantity',True);freight=nonnegative(line,'freight');tax=nonnegative(line,'tax');discount=nonnegative(line,'discount');other=nonnegative(line,'other_charges')
        requested=float((fetch_one('SELECT SUM(pi.quantity)quantity FROM pr_items pi JOIN rfqs r ON r.pr_id=pi.pr_id WHERE r.id=?AND pi.item_id=?',(rfq_id,item_id))or{})['quantity']or 0)
        if quantity>requested+.0001:raise HTTPException(409,'Quoted quantity exceeds the RFQ requested quantity')
        if tax>100:raise HTTPException(400,'Tax percentage cannot exceed 100')
        prepared.append((line,item_id,price,quantity,freight,tax,discount,other))
    with transaction(immediate=True)as c:
        ids=[]
        for line,item_id,price,quantity,freight,tax,discount,other in prepared:
            if c.execute('SELECT 1 FROM supplier_quotations WHERE rfq_id=?AND supplier_id=?AND item_id=?',(rfq_id,body.get('supplier_id'),item_id)).fetchone():raise HTTPException(409,'A quotation already exists for this supplier and one or more selected RFQ items; record a controlled revision instead')
            values={**body,**line};values.pop('items',None)
            cur=c.execute("""INSERT INTO supplier_quotations(rfq_id,supplier_id,item_id,price,freight,tax,currency,delivery_time_days,payment_terms,quality_rating,warranty,quotation_number,quotation_date,validity_date,quoted_quantity,discount,other_charges,delivery_date,technical_compliance,commercial_compliance,country_of_origin,remarks,created_by,created_at)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))""",(rfq_id,body.get('supplier_id'),item_id,price,freight,tax,body.get('currency')or(fetch_one('SELECT currency FROM company ORDER BY id DESC LIMIT 1')or{}).get('currency','SAR'),values.get('delivery_time_days'),body.get('payment_terms'),body.get('quality_rating'),body.get('warranty'),body.get('quotation_number'),body.get('quotation_date'),body.get('validity_date'),quantity,discount,other,values.get('delivery_date'),values.get('technical_compliance'),values.get('commercial_compliance'),body.get('country_of_origin'),body.get('remarks'),_u['id']));ids.append(cur.lastrowid);log_audit(c,'supplier_quotations',cur.lastrowid,'CREATE',_u['id'],after=values)
        c.execute("UPDATE rfqs SET workflow_status='Quotations Received',updated_at=datetime('now') WHERE id=?",(rfq_id,));c.execute("UPDATE rfq_suppliers SET response_status='Quotation Received',quotation_received_at=datetime('now') WHERE rfq_id=?AND supplier_id=?",(rfq_id,body.get('supplier_id')))
    return {'id':ids[0],'ids':ids,'lines_created':len(ids)}
@router.get('/rfqs/{rfq_id}/comparison')
def comparison(rfq_id:int,_u:dict=Depends(roles(*PROC))):return fetch_all("""SELECT sq.*,s.name supplier_name,s.rating supplier_score,i.item_code,i.description,pi.quantity requested_quantity,(sq.price*COALESCE(sq.quoted_quantity,pi.quantity)-sq.discount+sq.freight+sq.other_charges+(sq.price*COALESCE(sq.quoted_quantity,pi.quantity)*sq.tax/100.0))total_landed_cost,CASE WHEN sq.id=(SELECT candidate.id FROM supplier_quotations candidate JOIN rfqs cr ON cr.id=candidate.rfq_id LEFT JOIN pr_items cp ON cp.pr_id=cr.pr_id AND cp.item_id=candidate.item_id WHERE candidate.rfq_id=sq.rfq_id AND candidate.item_id=sq.item_id AND candidate.active_yn=1 ORDER BY(candidate.price*COALESCE(candidate.quoted_quantity,cp.quantity)-candidate.discount+candidate.freight+candidate.other_charges+(candidate.price*COALESCE(candidate.quoted_quantity,cp.quantity)*candidate.tax/100.0)),candidate.id LIMIT 1)THEN 1 ELSE 0 END lowest_evaluated FROM supplier_quotations sq JOIN suppliers s ON s.id=sq.supplier_id JOIN items i ON i.id=sq.item_id JOIN rfqs r ON r.id=sq.rfq_id LEFT JOIN pr_items pi ON pi.pr_id=r.pr_id AND pi.item_id=sq.item_id WHERE sq.rfq_id=?AND sq.active_yn=1 ORDER BY sq.item_id,total_landed_cost""",(rfq_id,))
@router.put('/quotations/{quote_id}/select')
def select(quote_id:int,_u:dict=Depends(roles('PurchaseOfficer','PurchaseManager','SupplyChainManager'))):
    q=fetch_one('SELECT * FROM supplier_quotations WHERE id=?',(quote_id,));
    if not q:raise HTTPException(404,'Quotation not found')
    with transaction(immediate=True)as c:c.execute('UPDATE supplier_quotations SET selected=0 WHERE rfq_id=? AND item_id=?',(q['rfq_id'],q['item_id']));c.execute('UPDATE supplier_quotations SET selected=1 WHERE id=?',(quote_id,))
    return {'success':True}

@router.put('/rfqs/{rfq_id}/issue')
def issue_rfq(rfq_id:int,body:dict,user:dict=Depends(roles('PurchaseOfficer','PurchaseManager','SupplyChainManager'))):
    row=require_rfq(rfq_id,{'Draft'})
    if not row.get('closing_date')or row['closing_date']<=datetime.now().date().isoformat():raise HTTPException(409,'Set a future quotation closing date before issue')
    if not fetch_one('SELECT 1 ok FROM rfq_suppliers WHERE rfq_id=?',(rfq_id,)):raise HTTPException(409,'Invite at least one approved supplier before issuing the RFQ')
    with transaction(immediate=True)as c:c.execute("UPDATE rfqs SET workflow_status='Issued',issue_date=COALESCE(issue_date,date('now')),updated_at=datetime('now')WHERE id=?",(rfq_id,));c.execute("UPDATE rfq_suppliers SET issued_at=datetime('now'),sent_method=COALESCE(?,sent_method,'Controlled RFQ Document'),response_status='Awaiting Response' WHERE rfq_id=?",(body.get('sent_method'),rfq_id));log_audit(c,'rfqs',rfq_id,'UPDATE',user['id'],row,{**body,'workflow_action':'ISSUE'})
    return {'success':True,'status':'Issued'}

@router.put('/rfqs/{rfq_id}')
def edit_rfq(rfq_id:int,body:dict,user:dict=Depends(roles('PurchaseOfficer','PurchaseManager','SupplyChainManager'))):
    row=require_rfq(rfq_id,{'Draft'})
    allowed=['issue_date','closing_date','required_delivery_date','delivery_warehouse_id','currency','payment_terms','incoterms','contact_person','notes','commercial_terms','technical_requirements'];values={key:body.get(key)for key in allowed if key in body}
    if values.get('closing_date')and values['closing_date']<=datetime.now().date().isoformat():raise HTTPException(400,'Quotation closing date must be in the future')
    if not values:raise HTTPException(400,'No editable RFQ fields were provided')
    with transaction(immediate=True)as c:c.execute(f"UPDATE rfqs SET {','.join(key+'=?'for key in values)},updated_at=datetime('now')WHERE id=?",(*values.values(),rfq_id));log_audit(c,'rfqs',rfq_id,'UPDATE',user['id'],row,{**values,'workflow_action':'UPDATE_DRAFT'})
    return rfq_detail(rfq_id,user)

@router.put('/rfqs/{rfq_id}/cancel')
def cancel_rfq(rfq_id:int,body:dict,user:dict=Depends(roles('PurchaseManager','SupplyChainManager'))):
    row=require_rfq(rfq_id,{'Draft','Issued','Quotations Pending','Quotations Received','Under Evaluation','Awaiting Approval'})
    reason=str(body.get('reason')or'').strip()
    if not reason:raise HTTPException(400,'Cancellation reason is required')
    if fetch_one('SELECT 1 ok FROM rfq_awards WHERE rfq_id=?AND po_id IS NOT NULL',(rfq_id,)):raise HTTPException(409,'RFQ with converted purchase orders cannot be cancelled')
    with transaction(immediate=True)as c:c.execute("UPDATE rfqs SET workflow_status='Cancelled',status='Closed',notes=trim(COALESCE(notes,'')||'\nCancellation: '||?),updated_at=datetime('now')WHERE id=?",(reason,rfq_id));log_audit(c,'rfqs',rfq_id,'UPDATE',user['id'],row,{'reason':reason,'workflow_action':'CANCEL'})
    return {'success':True,'status':'Cancelled'}

@router.post('/quotations/{quote_id}/revise',status_code=201)
def revise_quote(quote_id:int,body:dict,user:dict=Depends(roles('PurchaseOfficer','PurchaseManager','SupplyChainManager'))):
    previous=fetch_one('SELECT * FROM supplier_quotations WHERE id=?AND active_yn=1',(quote_id,))
    if not previous:raise HTTPException(404,'Active quotation not found')
    require_rfq(previous['rfq_id'],{'Issued','Quotations Pending','Quotations Received','Under Evaluation'})
    if not str(body.get('revision_reason')or'').strip():raise HTTPException(400,'A quotation revision reason is required')
    merged={**previous,**body};columns=['rfq_id','supplier_id','item_id','price','freight','tax','currency','delivery_time_days','payment_terms','quality_rating','warranty','quotation_number','quotation_date','validity_date','quoted_quantity','discount','other_charges','delivery_date','technical_compliance','commercial_compliance','country_of_origin','remarks']
    for key in ('price','quoted_quantity'):merged[key]=nonnegative(merged,key,True)
    for key in ('freight','tax','discount','other_charges'):merged[key]=nonnegative(merged,key)
    if merged['tax']>100:raise HTTPException(400,'Tax percentage cannot exceed 100')
    requested=float((fetch_one('SELECT SUM(pi.quantity)quantity FROM pr_items pi JOIN rfqs r ON r.pr_id=pi.pr_id WHERE r.id=?AND pi.item_id=?',(previous['rfq_id'],previous['item_id']))or{})['quantity']or 0)
    if merged['quoted_quantity']>requested+.0001:raise HTTPException(409,'Quoted quantity exceeds the RFQ requested quantity')
    with transaction(immediate=True)as c:
        c.execute('UPDATE supplier_quotations SET active_yn=0 WHERE id=?',(quote_id,));cursor=c.execute(f"INSERT INTO supplier_quotations({','.join(columns)},revision_number,created_by,created_at)VALUES({','.join('?'for _ in columns)},?,?,datetime('now'))",tuple(merged.get(key)for key in columns)+(int(previous.get('revision_number')or 1)+1,user['id']));c.execute('UPDATE supplier_quotations SET superseded_by_id=? WHERE id=?',(cursor.lastrowid,quote_id));log_audit(c,'supplier_quotations',cursor.lastrowid,'UPDATE',user['id'],previous,{**body,'supersedes_id':quote_id,'workflow_action':'REVISION'});new_id=cursor.lastrowid
    return {'id':new_id,'revision_number':int(previous.get('revision_number')or 1)+1}

@router.get('/rfqs/{rfq_id}/awards')
def awards(rfq_id:int,_u:dict=Depends(roles(*PROC))):return fetch_all('SELECT a.*,s.name supplier_name,i.item_code,i.description,sq.price,sq.currency,sq.quotation_number,po.po_number FROM rfq_awards a JOIN suppliers s ON s.id=a.supplier_id JOIN items i ON i.id=a.item_id JOIN supplier_quotations sq ON sq.id=a.quotation_id LEFT JOIN purchase_orders po ON po.id=a.po_id WHERE a.rfq_id=? ORDER BY i.item_code,s.name',(rfq_id,))

@router.post('/rfqs/{rfq_id}/awards',status_code=201)
def recommend_award(rfq_id:int,body:dict,user:dict=Depends(roles('PurchaseOfficer','PurchaseManager','SupplyChainManager'))):
    require_rfq(rfq_id,{'Quotations Received','Under Evaluation','Awaiting Approval'})
    quote=fetch_one('SELECT sq.*,r.pr_id FROM supplier_quotations sq JOIN rfqs r ON r.id=sq.rfq_id WHERE sq.id=?AND sq.rfq_id=?AND sq.active_yn=1',(body.get('quotation_id'),rfq_id))
    if not quote:raise HTTPException(404,'Active quotation not found')
    try:quantity=float(body.get('awarded_quantity'))
    except(TypeError,ValueError):raise HTTPException(400,'Awarded quantity must be numeric')
    if quantity<=0:raise HTTPException(400,'Awarded quantity must be greater than zero')
    if quantity>float(quote.get('quoted_quantity')or 0)+.0001:raise HTTPException(409,'Award quantity exceeds the supplier quoted quantity')
    reason=str(body.get('recommendation_reason')or'').strip()
    if not reason:raise HTTPException(400,'Recommendation reason is required')
    lowest=fetch_one("""SELECT sq.id FROM supplier_quotations sq JOIN rfqs r ON r.id=sq.rfq_id LEFT JOIN pr_items pi ON pi.pr_id=r.pr_id AND pi.item_id=sq.item_id WHERE sq.rfq_id=?AND sq.item_id=?AND sq.active_yn=1 ORDER BY(sq.price*COALESCE(sq.quoted_quantity,pi.quantity)-sq.discount+sq.freight+sq.other_charges+(sq.price*COALESCE(sq.quoted_quantity,pi.quantity)*sq.tax/100.0)),sq.id LIMIT 1""",(rfq_id,quote['item_id']))
    justification=str(body.get('non_lowest_justification')or'').strip()
    if lowest and lowest['id']!=quote['id']and not justification:raise HTTPException(400,'A justification is required when the recommended supplier is not the lowest evaluated bidder')
    with transaction(immediate=True)as c:
        approved_qty=float(c.execute('SELECT COALESCE(SUM(quantity),0)quantity FROM pr_items WHERE pr_id=?AND item_id=?',(quote['pr_id'],quote['item_id'])).fetchone()['quantity']);already=float(c.execute("SELECT COALESCE(SUM(awarded_quantity),0)quantity FROM rfq_awards WHERE rfq_id=?AND item_id=?AND status<>'Rejected'",(rfq_id,quote['item_id'])).fetchone()['quantity'])
        if already+quantity>approved_qty+.0001:raise HTTPException(409,'Award quantity exceeds the approved PR quantity')
        cursor=c.execute("INSERT INTO rfq_awards(rfq_id,quotation_id,supplier_id,item_id,awarded_quantity,recommendation_reason,non_lowest_justification,recommended_by)VALUES(?,?,?,?,?,?,?,?)",(rfq_id,quote['id'],quote['supplier_id'],quote['item_id'],quantity,reason,justification or None,user['id']));c.execute("UPDATE rfqs SET workflow_status='Awaiting Approval',updated_at=datetime('now')WHERE id=?",(rfq_id,));log_audit(c,'rfq_awards',cursor.lastrowid,'CREATE',user['id'],after={**body,'workflow_action':'RECOMMEND'});award_id=cursor.lastrowid
    return {'id':award_id,'status':'Awaiting Approval'}

@router.put('/rfq-awards/{award_id}/decision')
def award_decision(award_id:int,body:dict,user:dict=Depends(roles('PurchaseManager','SupplyChainManager'))):
    decision=body.get('decision');award=fetch_one('SELECT * FROM rfq_awards WHERE id=?',(award_id,))
    if not award:raise HTTPException(404,'Award recommendation not found')
    if award['status']!='Awaiting Approval':raise HTTPException(409,f"Award is already {award['status']}")
    if decision not in('Approved','Rejected'):raise HTTPException(400,'Decision must be Approved or Rejected')
    self_decision=award['recommended_by']==user['id']
    if decision=='Rejected'and not str(body.get('reason')or'').strip():raise HTTPException(400,'Rejection reason is required')
    value=float((fetch_one('SELECT a.awarded_quantity*(q.price*(1+q.tax/100.0))-q.discount+q.freight+q.other_charges value FROM rfq_awards a JOIN supplier_quotations q ON q.id=a.quotation_id WHERE a.id=?',(award_id,))or{})['value']or 0);limit=float(user.get('approval_limit')or 0)
    if decision=='Approved'and user['role']!='SupplyChainManager'and value>limit:raise HTTPException(403,f'Award value exceeds your approval limit of {limit:.2f}')
    external=bool(body.get('external_approval_reference'))
    if decision=='Approved'and self_decision:
        if user['role']!='SupplyChainManager':raise HTTPException(403,'Only the Supply Chain Manager may approve their own award recommendation')
        if not external or not str(body.get('external_approved_by')or'').strip() or not body.get('external_approval_date'):raise HTTPException(409,'External management approval details are required for self-approval')
        if not fetch_one("SELECT id FROM document_attachments WHERE document_type='AWARD' AND document_id=? LIMIT 1",(award_id,)):raise HTTPException(409,'Upload the external management approval against this award before approving it')
    if decision=='Approved'and value>limit and user['role']=='SupplyChainManager'and not external:raise HTTPException(409,'External management approval reference is required above the assigned approval limit')
    with transaction(immediate=True)as c:
        c.execute("UPDATE rfq_awards SET status=?,approved_by=?,approved_at=datetime('now'),rejection_reason=?,approval_limit_snapshot=?,effective_limit_source='Employee approval limit',external_approval_required=?,external_approved_by=?,external_approval_reference=?,external_approval_date=?,external_approval_notes=? WHERE id=?",(decision,user['id'],body.get('reason'),limit,int(external),body.get('external_approved_by'),body.get('external_approval_reference'),body.get('external_approval_date'),body.get('external_approval_notes'),award_id));pending=c.execute("SELECT 1 FROM rfq_awards WHERE rfq_id=?AND status='Awaiting Approval'LIMIT 1",(award['rfq_id'],)).fetchone();approved=c.execute("SELECT 1 FROM rfq_awards WHERE rfq_id=?AND status='Approved'LIMIT 1",(award['rfq_id'],)).fetchone();new_status='Awaiting Approval'if pending else('Awarded'if approved else'Under Evaluation');c.execute('UPDATE rfqs SET workflow_status=?,updated_at=datetime(\'now\')WHERE id=?',(new_status,award['rfq_id']));log_audit(c,'rfq_awards',award_id,'APPROVE' if decision=='Approved' else 'REJECT',user['id'],award,{**body,'approval_limit_snapshot':limit,'award_value':value})
    return {'success':True,'status':decision}

@router.post('/rfqs/{rfq_id}/create-purchase-orders',status_code=201)
def create_award_pos(rfq_id:int,user:dict=Depends(roles('PurchaseManager','SupplyChainManager'))):
    rfq=require_rfq(rfq_id,{'Awarded','Partially Awarded'});rows=fetch_all("SELECT a.*,sq.price,sq.tax,sq.currency,sq.discount,sq.freight,sq.other_charges,sq.delivery_date,sq.warranty,sq.payment_terms,sq.quotation_number FROM rfq_awards a JOIN supplier_quotations sq ON sq.id=a.quotation_id WHERE a.rfq_id=?AND a.status='Approved'AND a.po_id IS NULL",(rfq_id,))
    if not rfq or not rows:raise HTTPException(409,'No approved, unconverted award lines are available')
    created=[]
    with transaction(immediate=True)as c:
        for supplier_id in sorted({row['supplier_id']for row in rows}):
            lines=[row for row in rows if row['supplier_id']==supplier_id];total=sum(row['awarded_quantity']*row['price']*(1+row['tax']/100)-row['discount']+row['freight']+row['other_charges']for row in lines)
            if user['role']=='SupplyChainManager'and total>float(user.get('approval_limit')or 0):raise HTTPException(403,'Purchase order value exceeds the Supply Chain Manager assigned generation limit')
            num=number(c,'PO');cursor=c.execute("INSERT INTO purchase_orders(po_number,supplier_id,pr_id,rfq_id,committed_delivery_date,total_amount,status,created_by,transaction_currency)VALUES(?,?,?,?,?,?,'PendingApproval',?,?)",(num,supplier_id,rfq['pr_id'],rfq_id,rfq.get('required_delivery_date'),total,user['id'],lines[0]['currency']));po_id=cursor.lastrowid;c.execute('INSERT OR IGNORE INTO po_pr_links(po_id,pr_id)VALUES(?,?)',(po_id,rfq['pr_id']))
            for line in lines:
                c.execute('INSERT INTO po_items(po_id,item_id,quantity,price,tax,quotation_id,discount,freight,other_charges,delivery_date,warranty,technical_specifications)VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(po_id,line['item_id'],line['awarded_quantity'],line['price'],line['tax'],line['quotation_id'],line['discount'],line['freight'],line['other_charges'],line['delivery_date'],line['warranty'],rfq.get('technical_requirements')));pr_item=c.execute('SELECT id FROM pr_items WHERE pr_id=?AND item_id=?ORDER BY id LIMIT 1',(rfq['pr_id'],line['item_id'])).fetchone();c.execute('INSERT INTO po_pr_item_allocations(po_id,pr_id,pr_item_id,item_id,quantity)VALUES(?,?,?,?,?)',(po_id,rfq['pr_id'],pr_item['id'],line['item_id'],line['awarded_quantity']));c.execute('UPDATE rfq_awards SET po_id=?WHERE id=?',(po_id,line['id']))
            c.execute("INSERT INTO approval_log(document_type,document_id,document_number,required_role,requested_by,decision)VALUES('PO',?,?, 'PurchaseManager',?,'Pending')",(po_id,num,user['id']));log_audit(c,'purchase_orders',po_id,'CREATE',user['id'],after={'rfq_id':rfq_id,'supplier_id':supplier_id,'workflow_action':'CREATE_FROM_RFQ_AWARD'});created.append({'id':po_id,'po_number':num,'supplier_id':supplier_id})
        refresh_pr_order_status(c,rfq['pr_id'],user['id'],created[-1]['id']);remaining=c.execute("SELECT 1 FROM pr_items pi WHERE pi.pr_id=?AND pi.quantity>COALESCE((SELECT SUM(a.awarded_quantity)FROM rfq_awards a WHERE a.rfq_id=?AND a.item_id=pi.item_id AND a.status='Approved'),0)+.0001 LIMIT 1",(rfq['pr_id'],rfq_id)).fetchone();new_status='Partially Awarded'if remaining else'Closed';c.execute("UPDATE rfqs SET workflow_status=?,status=CASE WHEN ?='Closed'THEN'Closed'ELSE status END,updated_at=datetime('now')WHERE id=?",(new_status,new_status,rfq_id));log_audit(c,'rfqs',rfq_id,'UPDATE',user['id'],after={'purchase_orders':created,'workflow_status':new_status,'workflow_action':'CONVERT_TO_PO'})
    return {'purchase_orders':created}

@router.get('/rfqs/{rfq_id}/traceability')
def rfq_traceability(rfq_id:int,_u:dict=Depends(roles(*PROC))):
    rfq=fetch_one('SELECT r.id,r.rfq_number,r.workflow_status,pr.id pr_id,pr.pr_number FROM rfqs r LEFT JOIN purchase_requisitions pr ON pr.id=r.pr_id WHERE r.id=?',(rfq_id,))
    if not rfq:raise HTTPException(404,'RFQ not found')
    rfq['purchase_orders']=fetch_all('SELECT id,po_number,status FROM purchase_orders WHERE rfq_id=?',(rfq_id,));rfq['grns']=fetch_all('SELECT g.id,g.grn_number,g.po_id FROM grns g JOIN purchase_orders po ON po.id=g.po_id WHERE po.rfq_id=?',(rfq_id,));rfq['invoices']=fetch_all('SELECT inv.id,inv.invoice_number,inv.po_id,inv.match_status FROM invoices inv JOIN purchase_orders po ON po.id=inv.po_id WHERE po.rfq_id=?',(rfq_id,));return rfq

@router.get('/rfqs/{rfq_id}/audit')
def rfq_audit(rfq_id:int,_u:dict=Depends(roles(*PROC))):
    quote_ids=[row['id']for row in fetch_all('SELECT id FROM supplier_quotations WHERE rfq_id=?',(rfq_id,))];award_ids=[row['id']for row in fetch_all('SELECT id FROM rfq_awards WHERE rfq_id=?',(rfq_id,))];clauses=['(a.table_name=\'rfqs\'AND a.record_id=?)'];params=[rfq_id]
    if quote_ids:clauses.append("(a.table_name='supplier_quotations'AND a.record_id IN(%s))"%','.join('?'for _ in quote_ids));params.extend(quote_ids)
    if award_ids:clauses.append("(a.table_name='rfq_awards'AND a.record_id IN(%s))"%','.join('?'for _ in award_ids));params.extend(award_ids)
    return fetch_all(f"SELECT a.*,a.changed_at created_at,u.full_name changed_by_name FROM audit_log a LEFT JOIN users u ON u.id=a.changed_by WHERE {' OR '.join(clauses)} ORDER BY a.id DESC",params)

@router.get('/pos')
def pos(user:dict=Depends(roles(*ALL))):return fetch_all("SELECT po.*,s.name supplier_name,(SELECT COUNT(*) FROM grns g WHERE g.po_id=po.id)grn_count FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id "+("WHERE po.status IN('Approved','Printed') " if user['role'] in ['WarehouseManager','WarehouseSupervisor','Storekeeper']else'')+'ORDER BY po.id DESC')
@router.get('/pos/{po_id}')
def get_po(po_id:int,user:dict=Depends(roles(*ALL))):return detail('PO',po_id)
@router.post('/pos',status_code=201)
def create_po(body:dict,user:dict=Depends(roles(*PROC))):
    items=body.get('items');validate_lines(items,True);total=sum(x['quantity']*x['price']*(1+x.get('tax',0)/100)for x in items)
    pr_ids=list(dict.fromkeys(int(value) for value in(body.get('pr_ids')or[])if value))
    company=fetch_one("SELECT COALESCE(base_currency,currency,'SAR') base_currency FROM company WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1")or{'base_currency':'SAR'};base_currency=company['base_currency'];transaction_currency=str(body.get('transaction_currency')or base_currency).upper()
    rate_row={'rate':1,'source':'System parity rate'}if transaction_currency==base_currency else fetch_one("SELECT rate,source,effective_date,expiry_date FROM exchange_rates WHERE from_currency=? AND to_currency=? AND active_yn=1 AND effective_date<=date('now') AND(expiry_date IS NULL OR expiry_date>=date('now')) ORDER BY effective_date DESC,id DESC LIMIT 1",(transaction_currency,base_currency))
    if not rate_row:raise HTTPException(409,f'Synchronize an authenticated {transaction_currency} to {base_currency} exchange rate before creating this purchase order')
    exchange_rate=float(rate_row['rate']);base_total=round(total*exchange_rate,2);requester=employee_for_user(user)
    if not requester:raise HTTPException(403,'An active Procurement employee record is required')
    approver,limit,level,rule=route_approver(requester['id'],base_total,'PO')
    with transaction(immediate=True)as c:
        if pr_ids:
            approved={row['id']for row in c.execute("SELECT pr.id FROM purchase_requisitions pr WHERE pr.id IN(%s) AND pr.status IN('Submitted','Approved') AND EXISTS(SELECT 1 FROM approval_log al WHERE al.document_type='PR'AND al.document_id=pr.id AND al.decision='Approved')"%','.join('?'for _ in pr_ids),pr_ids).fetchall()}
            if approved!=set(pr_ids):raise HTTPException(409,'Every linked PR must be approved and open for ordering')
        allocations=[]
        for line in items:
            remaining=float(line['quantity'])
            if pr_ids:
                candidates=c.execute("""SELECT x.id pr_item_id,x.pr_id,x.quantity-COALESCE((SELECT SUM(a.quantity)FROM po_pr_item_allocations a JOIN purchase_orders po ON po.id=a.po_id WHERE a.pr_item_id=x.id AND po.status NOT IN('Rejected')),0)available FROM pr_items x WHERE x.item_id=? AND x.pr_id IN(%s) ORDER BY x.pr_id,x.id"""%','.join('?'for _ in pr_ids),(line['item_id'],*pr_ids)).fetchall()
                for candidate in candidates:
                    assigned=min(remaining,max(0,float(candidate['available'])))
                    if assigned>0:allocations.append((candidate['pr_id'],candidate['pr_item_id'],line['item_id'],assigned));remaining-=assigned
                    if remaining<=.0001:break
                if remaining>.0001:raise HTTPException(409,f"PO quantity exceeds the approved outstanding PR quantity for item {line['item_id']}")
        external_required=approver['user_role']=='SupplyChainManager'and base_total>limit;management_ref=number(c,'MAR')if external_required else None
        num=number(c,'PO');cur=c.execute("INSERT INTO purchase_orders(po_number,supplier_id,rfq_id,committed_delivery_date,total_amount,transaction_currency,exchange_rate,base_currency,base_currency_amount,status,created_by,external_approval_required,management_approval_request_number)VALUES(?,?,?,?,?,?,?,?,?,'PendingApproval',?,?,?)",(num,body.get('supplier_id'),body.get('rfq_id'),body.get('committed_delivery_date'),total,transaction_currency,exchange_rate,base_currency,base_total,user['id'],int(external_required),management_ref));pid=cur.lastrowid
        for line in items:c.execute('INSERT INTO po_items(po_id,item_id,quantity,price,tax)VALUES(?,?,?,?,?)',(pid,line['item_id'],line['quantity'],line['price'],line.get('tax',0)))
        for pr_id in pr_ids:c.execute('INSERT INTO po_pr_links(po_id,pr_id)VALUES(?,?)',(pid,pr_id))
        for pr_id,pr_item_id,item_id,quantity in allocations:c.execute('INSERT INTO po_pr_item_allocations(po_id,pr_id,pr_item_id,item_id,quantity)VALUES(?,?,?,?,?)',(pid,pr_id,pr_item_id,item_id,quantity))
        for pr_id in pr_ids:refresh_pr_order_status(c,pr_id,user['id'],pid)
        c.execute("INSERT INTO approval_log(document_type,document_id,document_number,required_role,requested_by,decision,approval_value,approval_currency,approver_employee_id,approver_role,workflow_level,escalation_rule)VALUES('PO',?,?,?,?,'Pending',?,?,?,?,?,?)",(pid,num,approver['user_role'],user['id'],base_total,base_currency,approver['id'],approver['user_role'],str(level),rule));log_audit(c,'purchase_orders',pid,'CREATE',user['id'],after={**body,'transaction_currency':transaction_currency,'exchange_rate':exchange_rate,'base_currency':base_currency,'base_currency_amount':base_total,'exchange_rate_source':rate_row.get('source'),'routed_approver_employee_id':approver['id'],'external_approval_required':external_required})
    return {'id':pid,'po_number':num,'status':'PendingApproval','total_amount':total,'transaction_currency':transaction_currency,'exchange_rate':exchange_rate,'base_currency':base_currency,'base_currency_amount':base_total,'exchange_rate_source':rate_row.get('source')}
def revise_po(po_id,body,user,amend=False):
    po=fetch_one('SELECT * FROM purchase_orders WHERE id=?',(po_id,));
    if not po:raise HTTPException(404,'PO not found')
    if amend and(not str(body.get('revision_reason')or'').strip()or po['status']not in['Approved','Printed']):raise HTTPException(409,'Only an approved, unreceived PO can enter controlled amendment with a revision reason')
    if not amend and po['status']!='PendingApproval':raise HTTPException(409,f"PO is {po['status']} and cannot be edited")
    items=body.get('items');validate_lines(items,True);total=sum(x['quantity']*x['price']*(1+x.get('tax',0)/100)for x in items)
    pr_ids=[row['pr_id']for row in fetch_all('SELECT pr_id FROM po_pr_links WHERE po_id=?',(po_id,))]
    with transaction(immediate=True)as c:
        if amend:c.execute("INSERT INTO document_revisions(document_type,document_id,revision_number,changed_by,change_reason,previous_values,new_values)VALUES('PO',?,COALESCE((SELECT MAX(revision_number)+1 FROM document_revisions WHERE document_type='PO'AND document_id=?),1),?,?,?,?)",(po_id,po_id,user['id'],body['revision_reason'],str(po),str(body)))
        c.execute("UPDATE purchase_orders SET supplier_id=?,committed_delivery_date=?,total_amount=?,status='PendingApproval'WHERE id=?",(body.get('supplier_id'),body.get('committed_delivery_date'),total,po_id));c.execute('DELETE FROM po_items WHERE po_id=?',(po_id,));c.execute('DELETE FROM po_pr_item_allocations WHERE po_id=?',(po_id,));[c.execute('INSERT INTO po_items(po_id,item_id,quantity,price,tax)VALUES(?,?,?,?,?)',(po_id,x['item_id'],x['quantity'],x['price'],x.get('tax',0)))for x in items]
        for line in items:
            remaining=float(line['quantity'])
            if pr_ids:
                candidates=c.execute("""SELECT x.id pr_item_id,x.pr_id,x.quantity-COALESCE((SELECT SUM(a.quantity)FROM po_pr_item_allocations a JOIN purchase_orders linked ON linked.id=a.po_id WHERE a.pr_item_id=x.id AND linked.status NOT IN('Rejected')),0)available FROM pr_items x WHERE x.item_id=? AND x.pr_id IN(%s) ORDER BY x.pr_id,x.id"""%','.join('?'for _ in pr_ids),(line['item_id'],*pr_ids)).fetchall()
                for candidate in candidates:
                    assigned=min(remaining,max(0,float(candidate['available'])))
                    if assigned>0:c.execute('INSERT INTO po_pr_item_allocations(po_id,pr_id,pr_item_id,item_id,quantity)VALUES(?,?,?,?,?)',(po_id,candidate['pr_id'],candidate['pr_item_id'],line['item_id'],assigned));remaining-=assigned
                    if remaining<=.0001:break
                if remaining>.0001:raise HTTPException(409,f"PO quantity exceeds the approved outstanding PR quantity for item {line['item_id']}")
        for pr_id in pr_ids:refresh_pr_order_status(c,pr_id,user['id'],po_id)
        if amend:c.execute("INSERT INTO approval_log(document_type,document_id,document_number,required_role,requested_by,decision)VALUES('PO',?,?, 'SupplyChainManager',?,'Pending')",(po_id,po['po_number'],user['id']))
        log_audit(c,'purchase_orders',po_id,'UPDATE',user['id'],po,body)
    return {'success':True,'status':'PendingApproval','total_amount':total}
@router.put('/pos/{po_id}')
def edit_po(po_id:int,body:dict,user:dict=Depends(roles('SupplyChainManager'))):return revise_po(po_id,body,user)
@router.put('/pos/{po_id}/amend')
def amend_po(po_id:int,body:dict,user:dict=Depends(roles('SupplyChainManager'))):return revise_po(po_id,body,user,True)
@router.put('/pos/{po_id}/approve')
def approve_po(po_id:int,body:dict,user:dict=Depends(roles(*PROC))):
    po=fetch_one('SELECT * FROM purchase_orders WHERE id=?',(po_id,));
    if not po:raise HTTPException(404,'PO not found')
    if po['status']!='PendingApproval':raise HTTPException(409,f"PO is {po['status']} and cannot be approved")
    pending=fetch_one("SELECT * FROM approval_log WHERE document_type='PO' AND document_id=? AND decision='Pending' ORDER BY sequence,id LIMIT 1",(po_id,))
    if not pending:raise HTTPException(409,'This PO has no pending approval decision')
    value=float(po.get('base_currency_amount')or po.get('total_amount')or 0);delegation=active_delegation(user,'PROC_PO_APPROVE','PO',po_id)
    try:employee,approval_limit,authority=approval_authorized(user,po['created_by'],value,'PO',pending=pending)
    except HTTPException:
        if not delegation:raise
        employee,approval_limit,authority=None,None,'Delegated Authority'
    if po.get('external_approval_required'):
        if user['role']!='SupplyChainManager':raise HTTPException(403,'Only the Supply Chain Manager may approve a PO above the SCM limit')
        if not fetch_one("SELECT id FROM document_attachments WHERE document_type='MANUAL_APPROVAL' AND document_id=? LIMIT 1",(po_id,)):raise HTTPException(409,'Upload the signed higher-management approval before approving this PO')
        if not str(body.get('approval_ref_number')or'').strip():raise HTTPException(400,'Higher-management approval reference is required')
    with transaction(immediate=True)as c:c.execute("UPDATE purchase_orders SET status='Approved',approval_ref_number=?,approval_person_name=? WHERE id=?",(body.get('approval_ref_number'),body.get('approval_person_name'),po_id));c.execute("UPDATE approval_log SET decision='Approved',decision_by=?,decision_date=datetime('now'),approval_limit_used=?,approval_limit_source=? WHERE id=?",(user['id'],approval_limit,authority,pending['id']));delegated=record_delegated_use(c,delegation,user,'purchase_orders',po_id,'APPROVE')if delegation else{};log_audit(c,'purchase_orders',po_id,'APPROVE',user['id'],po,{**body,'authority':authority,'approval_limit':approval_limit,**delegated})
    return {'success':True,'status':'Approved'}
@router.put('/pos/{po_id}/reject')
def reject_po(po_id:int,user:dict=Depends(roles('PurchaseManager','SupplyChainManager'))):
    po=fetch_one('SELECT * FROM purchase_orders WHERE id=?',(po_id,))
    if not po:raise HTTPException(404,'PO not found')
    if po['status']!='PendingApproval':raise HTTPException(409,f"PO is {po['status']} and cannot be rejected")
    pending=fetch_one("SELECT * FROM approval_log WHERE document_type='PO' AND document_id=? AND decision='Pending' ORDER BY sequence,id LIMIT 1",(po_id,))
    if not pending:raise HTTPException(409,'This PO has no pending approval decision')
    approval_authorized(user,po['created_by'],float(po.get('base_currency_amount')or po.get('total_amount')or 0),'PO',pending=pending)
    with transaction(immediate=True)as c:
        c.execute("UPDATE purchase_orders SET status='Rejected' WHERE id=?",(po_id,));c.execute("UPDATE approval_log SET decision='Rejected',decision_by=?,decision_date=datetime('now') WHERE document_type='PO' AND document_id=? AND decision='Pending'",(user['id'],po_id));[refresh_pr_order_status(c,row['pr_id'],user['id'],po_id)for row in c.execute('SELECT pr_id FROM po_pr_links WHERE po_id=?',(po_id,)).fetchall()];log_audit(c,'purchase_orders',po_id,'REJECT',user['id'])
    return {'success':True}
@router.get('/pos/{po_id}/approval-history')
def po_history(po_id:int,_u:User):return approval_history('PO',po_id)
@router.post('/pos/{po_id}/print')
def print_po(po_id:int,user:dict=Depends(roles(*PROC))):
    po=fetch_one('SELECT * FROM purchase_orders WHERE id=?',(po_id,))
    if not po:raise HTTPException(404,'PO not found')
    if po['status']not in('Approved','Printed','Closed'):raise HTTPException(409,'Purchase Order must be approved before printing or downloading')
    with transaction(immediate=True)as c:c.execute("UPDATE purchase_orders SET status=CASE WHEN status='Approved' THEN 'Printed' ELSE status END,print_count=COALESCE(print_count,0)+1 WHERE id=?",(po_id,));log_audit(c,'purchase_orders',po_id,'UPDATE',user['id'],after={'workflow_action':'PRINT'})
    return {'success':True}
@router.get('/pos/{po_id}/document')
def document(po_id:int,_u:User):
    row=detail('PO',po_id)
    items=row.pop('items',[])
    return {
        'po':row,
        'items':items,
        'company':fetch_one('SELECT * FROM company WHERE deleted_at IS NULL ORDER BY id LIMIT 1')or{},
        'approvals':approval_history('PO',po_id),
    }
@router.post('/pos/pricing')
def pricing(body:dict,_u:dict=Depends(roles(*PROC))):
    supplier=body.get('supplier_id');out=[]
    for item_id in set(body.get('item_ids')or[]):out.append(fetch_one("SELECT i.id item_id,(SELECT poi.price FROM po_items poi JOIN purchase_orders po ON po.id=poi.po_id WHERE poi.item_id=i.id AND po.supplier_id=? AND po.status='Closed' ORDER BY po.id DESC LIMIT 1)latest_supplier_price,(SELECT MIN(poi.price)FROM po_items poi JOIN purchase_orders po ON po.id=poi.po_id WHERE poi.item_id=i.id AND po.supplier_id=? AND po.status='Closed')supplier_lowest_price FROM items i WHERE i.id=?",(supplier,supplier,item_id)))
    return out
@router.get('/pos/{po_id}/invoice-context')
def invoice_context(po_id:int,_u:dict=Depends(roles(*PROC))):
    po=fetch_one('SELECT * FROM purchase_orders WHERE id=?',(po_id,));
    if not po:raise HTTPException(404,'PO not found')
    return {'po':po,'supplier':fetch_one('SELECT * FROM suppliers WHERE id=?',(po['supplier_id'],)),'items':fetch_all('''SELECT pi.*,i.item_code,i.description,pi.quantity ordered_qty,
      COALESCE((SELECT SUM(gi.accepted_qty) FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.po_id=pi.po_id AND gi.item_id=pi.item_id),0)accepted_qty,
      COALESCE((SELECT SUM(gi.rejected_qty) FROM grn_items gi JOIN grns g ON g.id=gi.grn_id WHERE g.po_id=pi.po_id AND gi.item_id=pi.item_id),0)rejected_qty
      FROM po_items pi JOIN items i ON i.id=pi.item_id WHERE pi.po_id=?''',(po_id,)),'receipts':fetch_all('''SELECT g.*,
      COALESCE(SUM(gi.accepted_qty),0)accepted_qty,
      ROUND(COALESCE(SUM(gi.accepted_qty*gi.unit_cost*(1+COALESCE(pi.tax,0)/100.0)),0),2)accepted_value
      FROM grns g LEFT JOIN grn_items gi ON gi.grn_id=g.id LEFT JOIN po_items pi ON pi.po_id=g.po_id AND pi.item_id=gi.item_id
      WHERE g.po_id=? GROUP BY g.id ORDER BY g.id''',(po_id,)),'grn_value':invoice_grn_value(po_id)}
@router.get('/invoices')
def invoices(_u:dict=Depends(roles(*PROC))):return fetch_all('SELECT inv.*,s.name supplier_name,po.po_number,g.grn_number FROM invoices inv JOIN suppliers s ON s.id=inv.supplier_id JOIN purchase_orders po ON po.id=inv.po_id LEFT JOIN grns g ON g.id=inv.grn_id ORDER BY inv.id DESC')
MATCH_TOLERANCE_RATE=.01
RECONCILIATION_REASONS={'SUPPLIER_CREDIT_NOTE','APPROVED_DISCOUNT','TAX_CORRECTION','FREIGHT_ADJUSTMENT','ROUNDING_DIFFERENCE','PRICE_CORRECTION','QUANTITY_DISCREPANCY','REJECTED_GOODS','CORRECTED_INVOICE','OTHER'}
def invoice_grn_value(po_id):
    row=fetch_one('''SELECT COALESCE(SUM(gi.accepted_qty*gi.unit_cost*(1+COALESCE(pi.tax,0)/100.0)),0)value
      FROM grn_items gi JOIN grns g ON g.id=gi.grn_id
      JOIN po_items pi ON pi.po_id=g.po_id AND pi.item_id=gi.item_id WHERE g.po_id=?''',(po_id,))or{}
    return round(float(row.get('value')or 0),2)
def within_match_tolerance(left,right):
    tolerance=max(.01,abs(float(left or 0))*MATCH_TOLERANCE_RATE,abs(float(right or 0))*MATCH_TOLERANCE_RATE)
    return abs(float(left or 0)-float(right or 0))<=tolerance
def finance_handoff_authority(user,invoice_id):
    if user['role']=='SupplyChainManager':return {'can_approve':True,'effective_role':'SupplyChainManager','delegation':None}
    delegation=active_delegation(user,'FINANCE_EXTERNAL_HANDOFF','INVOICE',invoice_id)
    return {'can_approve':bool(delegation),'effective_role':user['role'] if delegation else'SupplyChainManager','delegation':delegation}
def require_handoff_authority(user,invoice_id):
    authority=finance_handoff_authority(user,invoice_id)
    if not authority['can_approve']:raise HTTPException(403,'Only the Supply Chain Manager or an active, specifically authorized delegate may perform this action')
    return authority
def match_data(invoice_id):
    inv=fetch_one('SELECT * FROM invoices WHERE id=?',(invoice_id,));
    if not inv:raise HTTPException(404,'Invoice not found')
    po=fetch_one('SELECT * FROM purchase_orders WHERE id=?',(inv['po_id'],));grns=fetch_all('SELECT * FROM grns WHERE po_id=? ORDER BY id',(inv['po_id'],));grn_value=invoice_grn_value(inv['po_id']);adjusted=inv.get('adjusted_invoice_total')if inv.get('adjusted_invoice_total')is not None else inv['invoice_total'];return inv,po,grns,grn_value,float(adjusted)
@router.post('/invoices',status_code=201)
def create_invoice(body:dict,user:dict=Depends(roles(*PROC))):
    po=fetch_one('SELECT * FROM purchase_orders WHERE id=?',(body.get('po_id'),));
    if not po or po['status']!='Closed':raise HTTPException(409,'Invoice requires a fully received and closed PO')
    if body.get('supplier_id')!=po['supplier_id']:raise HTTPException(400,'Invoice supplier must match the Purchase Order supplier')
    number_text=str(body.get('invoice_number')or'').strip();invoice_date=str(body.get('invoice_date')or datetime.now().date().isoformat())
    if not number_text:raise HTTPException(400,'Supplier invoice number is required')
    if fetch_one('SELECT id FROM invoices WHERE supplier_id=? AND lower(trim(invoice_number))=lower(?)',(po['supplier_id'],number_text)):raise HTTPException(409,'This supplier invoice number is already registered')
    try:total=float(body.get('invoice_total'));tax=float(body.get('tax')or 0);parsed_date=datetime.fromisoformat(invoice_date).date()
    except (TypeError,ValueError):raise HTTPException(400,'Enter a valid invoice date and amount')
    if total<=0 or tax<0:raise HTTPException(400,'Invoice total must be positive and tax cannot be negative')
    if parsed_date>datetime.now().date():raise HTTPException(400,'Invoice date cannot be in the future')
    selected_grn=body.get('grn_id')
    if selected_grn and not fetch_one('SELECT id FROM grns WHERE id=? AND po_id=?',(selected_grn,po['id'])):raise HTTPException(400,'Selected GRN does not belong to the Purchase Order')
    grns=fetch_all('SELECT id FROM grns WHERE po_id=?',(po['id'],))
    if not grns:raise HTTPException(409,'Invoice requires at least one posted GRN')
    grn_value=invoice_grn_value(po['id']);source_match=within_match_tolerance(po['total_amount'],grn_value);status='Matched'if source_match and within_match_tolerance(total,po['total_amount']) and within_match_tolerance(total,grn_value)else'Variance'
    classification='Exact Match'if status=='Matched'else'Blocked - Source Documents Differ'if not source_match else'Unresolved Variance'
    invoice_currency=body.get('transaction_currency')or po.get('transaction_currency')or'SAR';invoice_rate=float(po.get('exchange_rate')or 1)if invoice_currency==po.get('transaction_currency')else 1;base_total=round(total*invoice_rate,2)
    with transaction(immediate=True)as c:
        if c.execute('SELECT id FROM invoices WHERE supplier_id=? AND lower(trim(invoice_number))=lower(?)',(po['supplier_id'],number_text)).fetchone():raise HTTPException(409,'This supplier invoice number is already registered')
        cur=c.execute('INSERT INTO invoices(invoice_number,supplier_id,po_id,grn_id,invoice_date,invoice_total,tax,match_status,created_by,transaction_currency,exchange_rate,base_currency,base_currency_amount,variance_reason,adjusted_invoice_total,reconciliation_classification,recommended_adjustment,source_documents_match)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(number_text,po['supplier_id'],po['id'],selected_grn,invoice_date,total,tax,status,user['id'],invoice_currency,invoice_rate,po.get('base_currency')or'SAR',base_total,body.get('variance_reason'),total,classification,round(po['total_amount']-total,2),int(source_match)));log_audit(c,'invoices',cur.lastrowid,'CREATE',user['id'],after={**body,'match_status':status,'grn_value':grn_value,'source_documents_match':source_match});iid=cur.lastrowid
    return {'id':iid,'match_status':status}
@router.put('/invoices/{invoice_id}/reconcile')
def reconcile(invoice_id:int,body:dict,user:User):
    authority=require_handoff_authority(user,invoice_id);inv,po,_,grn_value,_=match_data(invoice_id)
    if inv['finance_pack_status']!='Not Submitted':raise HTTPException(409,'A handed-off invoice is locked and cannot be reconciled')
    if inv.get('created_by')==user['id']:raise HTTPException(409,'The invoice creator cannot accept or reconcile its variance')
    if not within_match_tolerance(po['total_amount'],grn_value):raise HTTPException(409,'PO and accepted GRN values differ; correct the source documents before reconciling the invoice')
    try:adjust=float(body.get('reconciliation_adjustment',0))
    except (TypeError,ValueError):raise HTTPException(400,'Enter a valid reconciliation adjustment')
    note=str(body.get('variance_acceptance_note')or'').strip();reason=str(body.get('reconciliation_reason_code')or'').strip()
    adjusted=round(float(inv['invoice_total'])+adjust,2)
    if not within_match_tolerance(adjusted,po['total_amount']) or not within_match_tolerance(adjusted,grn_value):raise HTTPException(409,'The reconciliation must resolve both PO and GRN differences within tolerance')
    if abs(adjust)>.001 and (reason not in RECONCILIATION_REASONS or len(note)<10):raise HTTPException(400,'A valid reason category and detailed acceptance note are required')
    classification='Exact Match'if abs(adjust)<=.001 else'Reconciled';status='Matched'
    with transaction(immediate=True)as c:
        c.execute("UPDATE invoices SET reconciliation_adjustment=?,adjusted_invoice_total=?,variance_acceptance_note=?,reconciliation_reason_code=?,reconciliation_classification=?,match_status=?,variance_accepted_by=?,variance_accepted_at=datetime('now'),source_documents_match=1 WHERE id=?",(adjust,adjusted,note or None,reason or None,classification,status,user['id'],invoice_id));delegated=record_delegated_use(c,authority['delegation'],user,'invoices',invoice_id,'RECONCILE')if authority['delegation']else{};log_audit(c,'invoices',invoice_id,'RECONCILE',user['id'],inv,{**body,**delegated})
    return {'success':True,'match_status':status,'remaining_variance':round(adjusted-po['total_amount'],2)}
@router.get('/invoices/{invoice_id}/three-way-match')
def three_way(invoice_id:int,_u:dict=Depends(roles(*PROC))):
    inv,po,grns,grn_value,adjusted=match_data(invoice_id);return {'invoice':inv,'po':po,'grns':grns,'po_total':po['total_amount'],'grn_total':grn_value,'invoice_total':adjusted,'po_invoice_variance':round(adjusted-po['total_amount'],2),'grn_invoice_variance':round(adjusted-grn_value,2),'source_documents_match':within_match_tolerance(po['total_amount'],grn_value),'matched':inv['match_status']=='Matched' and within_match_tolerance(adjusted,po['total_amount']) and within_match_tolerance(adjusted,grn_value)}
@router.get('/invoices/{invoice_id}/payment-pack')
def payment_pack(invoice_id:int,user:dict=Depends(roles(*PROC))):
    inv,po,grns,grn_value,adjusted=match_data(invoice_id);supplier=fetch_one('SELECT * FROM suppliers WHERE id=?',(inv['supplier_id'],));attachments=fetch_all("SELECT * FROM document_attachments WHERE(document_type='INVOICE'AND document_id=?)OR(document_type='PO'AND document_id=?)",(invoice_id,po['id']))
    creator=fetch_one('SELECT u.full_name,e.signature_url FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id=?',(inv.get('created_by'),))or{};acceptor=fetch_one('SELECT u.full_name,e.signature_url FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id=?',(inv.get('variance_accepted_by'),))or{};confirmer=fetch_one('SELECT u.full_name,e.signature_url FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id=?',(inv.get('verified_by'),))or{}
    enriched={**inv,'supplier_name':supplier.get('name'),'supplier_code':supplier.get('supplier_code'),'payment_terms':supplier.get('payment_terms'),'po_number':po.get('po_number'),'po_date':po.get('po_date'),'po_total':po.get('total_amount'),'created_by_name':creator.get('full_name'),'created_by_signature_url':creator.get('signature_url'),'variance_accepted_by_name':acceptor.get('full_name'),'variance_accepted_by_signature_url':acceptor.get('signature_url'),'confirmed_by_name':confirmer.get('full_name'),'confirmed_by_signature_url':confirmer.get('signature_url')}
    duplicate=fetch_one('SELECT COUNT(*) count FROM invoices WHERE supplier_id=? AND lower(trim(invoice_number))=lower(trim(?))',(inv['supplier_id'],inv['invoice_number']))
    return {'invoice':enriched,'po':po,'supplier':supplier,'grns':grns,'grn_value':grn_value,'adjusted_invoice_total':adjusted,'company':fetch_one('SELECT * FROM company WHERE deleted_at IS NULL ORDER BY id LIMIT 1')or{},'attachments':attachments,'attachment_count':len(attachments),'duplicate_check_passed':int((duplicate or{}).get('count')or 0)==1,'analysis':{'classification':inv.get('reconciliation_classification'),'po_invoice_variance':round(adjusted-po['total_amount'],2),'grn_invoice_variance':round(adjusted-grn_value,2)},'approval_authority':finance_handoff_authority(user,invoice_id)}
@router.put('/invoices/{invoice_id}/ready-for-finance')
def finance(invoice_id:int,body:dict,user:User):
    inv=fetch_one('SELECT * FROM invoices WHERE id=?',(invoice_id,));
    if not inv:raise HTTPException(404,'Invoice not found')
    authority=require_handoff_authority(user,invoice_id)
    if inv['finance_pack_status']!='Not Submitted':raise HTTPException(409,'This invoice has already been handed off to Finance')
    if inv.get('created_by')==user['id']:raise HTTPException(409,'The invoice creator cannot authorize its Finance handoff')
    current,po,_,grn_value,adjusted=match_data(invoice_id)
    if current['match_status']!='Matched' or not within_match_tolerance(adjusted,po['total_amount']) or not within_match_tolerance(adjusted,grn_value):raise HTTPException(409,'Resolve all PO, GRN and invoice differences before Finance handoff')
    if not fetch_one("SELECT id FROM document_attachments WHERE document_type='INVOICE' AND document_id=? LIMIT 1",(invoice_id,)):raise HTTPException(409,'Attach the supplier invoice before Finance handoff')
    with transaction(immediate=True)as c:
        ref=number(c,'FINPACK');c.execute("UPDATE invoices SET finance_pack_reference=?,finance_pack_status='Ready for Finance - External Process',verified_by=?,verified_date=datetime('now'),finance_review_comments=? WHERE id=?",(ref,user['id'],str(body.get('comments')or'').strip()or None,invoice_id));delegated=record_delegated_use(c,authority['delegation'],user,'invoices',invoice_id,'FINANCE_HANDOFF')if authority['delegation']else{};log_audit(c,'invoices',invoice_id,'FINANCE_HANDOFF',user['id'],inv,{'finance_pack_status':'Ready for Finance - External Process',**delegated})
    return {'success':True,'finance_pack_reference':ref}
@router.put('/invoices/{invoice_id}/submit-finance')
def retired_submit(invoice_id:int,_u:User):raise HTTPException(410,'Use the Ready for Finance - External Process handoff action')
@router.put('/invoices/{invoice_id}/verify')
def verify(invoice_id:int,user:dict=Depends(roles('SupplyChainManager'))):
    raise HTTPException(410,'Use the controlled Ready for Finance handoff action')
