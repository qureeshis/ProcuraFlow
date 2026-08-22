import json
from datetime import datetime, timezone

from .database import fetch_all, fetch_one

ELIGIBLE_ROLES={
    'PurchaseOfficer':'Procurement','PurchaseManager':'Procurement',
    'Storekeeper':'Warehouse','WarehouseSupervisor':'Warehouse','WarehouseManager':'Warehouse',
}

AUTHORITIES={
    'PROC_PR_PROCESS':('Procurement','PR Processing Authority',['ALL_ASSIGNED_PROCUREMENT','PR']),
    'PROC_RFQ_MANAGE':('Procurement','RFQ Management Authority',['ALL_ASSIGNED_PROCUREMENT','RFQ']),
    'PROC_SUPPLIER_QUOTE_MANAGE':('Procurement','Supplier Quotation Management',['ALL_ASSIGNED_PROCUREMENT','RFQ']),
    'PROC_QUOTE_EVALUATE':('Procurement','Quotation Comparison / Evaluation',['ALL_ASSIGNED_PROCUREMENT','RFQ']),
    'PROC_SUPPLIER_SELECT':('Procurement','Supplier Selection Authority',['ALL_AUTHORIZED_PROCUREMENT','RFQ']),
    'PROC_PO_CREATE':('Procurement','PO Creation Authority',['ALL_ASSIGNED_PROCUREMENT','PO']),
    'PROC_PO_APPROVE':('Procurement','PO Approval Authority',['ALL_AUTHORIZED_PROCUREMENT','PO']),
    'PROC_PACKAGE_MANAGE':('Procurement','Procurement Package Authority',['ALL_ASSIGNED_PROCUREMENT','PROCUREMENT_PACKAGE']),
    'FINANCE_EXTERNAL_HANDOFF':('Procurement','Finance External Handoff',['ALL_AUTHORIZED_PROCUREMENT','INVOICE']),
    'WH_GRN_RECEIVE':('Warehouse','GRN / Goods Receipt Authority',['ALL_ASSIGNED_WAREHOUSES','WAREHOUSE','GRN']),
    'WH_MATERIAL_ISSUE':('Warehouse','Material Issue Authority',['ALL_ASSIGNED_WAREHOUSES','WAREHOUSE','MATERIAL_ISSUE']),
    'WH_MATERIAL_RETURN':('Warehouse','Material Return Authority',['ALL_ASSIGNED_WAREHOUSES','WAREHOUSE']),
    'WH_TRANSFER':('Warehouse','Warehouse Transfer Authority',['ALL_ASSIGNED_WAREHOUSES','WAREHOUSE','TRANSFER']),
    'WH_TRANSFER_APPROVE':('Warehouse','Transfer Approval',['ALL_ASSIGNED_WAREHOUSES','WAREHOUSE','TRANSFER']),
    'WH_INVENTORY_ADJUST':('Warehouse','Inventory Adjustment Authority',['WAREHOUSE','INVENTORY_ADJUSTMENT']),
    'WH_INVENTORY_ADJUST_APPROVE':('Warehouse','Inventory Adjustment Approval',['WAREHOUSE','INVENTORY_ADJUSTMENT']),
    'WH_CYCLE_COUNT':('Warehouse','Cycle Count Authority',['ALL_ASSIGNED_WAREHOUSES','WAREHOUSE']),
    'WH_STOCK_COUNT_APPROVE':('Warehouse','Stock Count Approval',['ALL_ASSIGNED_WAREHOUSES','WAREHOUSE']),
    'WH_TOOL_ISSUE_RETURN':('Warehouse','Tool Issue / Return Authority',['ALL_ASSIGNED_WAREHOUSES','WAREHOUSE']),
}

BROAD_SCOPES={'ALL_ASSIGNED_PROCUREMENT','ALL_AUTHORIZED_PROCUREMENT','ALL_ASSIGNED_WAREHOUSES'}
SCOPE_TABLES={
    'PR':('purchase_requisitions','pr_number'),'RFQ':('rfqs','rfq_number'),'PROCUREMENT_PACKAGE':('rfqs','rfq_number'),
    'PO':('purchase_orders','po_number'),'INVOICE':('invoices','invoice_number'),'WAREHOUSE':('warehouses','name'),
    'GRN':('grns','grn_number'),'MATERIAL_ISSUE':('material_issues','issue_number'),'TRANSFER':('transfers','transfer_number'),
    'INVENTORY_ADJUSTMENT':('stock_adjustments','adjustment_number'),
}

def utc_now():return datetime.now(timezone.utc).replace(tzinfo=None)

def status_for(row,now=None):
    if str(row.get('status')or'').upper()=='REVOKED':return 'Revoked'
    now=now or utc_now();start=datetime.fromisoformat(str(row['effective_from']).replace('Z','+00:00')).replace(tzinfo=None);end=datetime.fromisoformat(str(row['effective_until']).replace('Z','+00:00')).replace(tzinfo=None)
    return 'Scheduled' if now<start else 'Expired' if now>=end else 'Active'

def scope_matches(delegation,scope_type=None,scope_id=None,warehouse_id=None):
    stored=delegation['scope_type'];stored_id=delegation.get('scope_id')
    if stored in ('ALL_ASSIGNED_PROCUREMENT','ALL_AUTHORIZED_PROCUREMENT'):return True
    if stored=='ALL_ASSIGNED_WAREHOUSES':
        if warehouse_id is None:return False
        return bool(fetch_one('SELECT 1 ok FROM users u JOIN user_warehouse_assignments a ON a.user_id=u.id AND a.is_active=1 WHERE u.employee_id=? AND a.warehouse_id=?',(delegation['delegate_employee_id'],warehouse_id)))
    if stored=='WAREHOUSE':return int(stored_id)==int(warehouse_id or scope_id or 0)
    return stored==scope_type and int(stored_id or 0)==int(scope_id or 0)

def active_delegation(user,authority_code,scope_type=None,scope_id=None,warehouse_id=None):
    if authority_code not in AUTHORITIES or not user.get('employee_id'):return None
    rows=fetch_all("""SELECT da.*,delegator.name delegated_by_name
      FROM delegated_authorities da JOIN employees delegator ON delegator.id=da.delegator_employee_id
      WHERE da.delegate_employee_id=? AND da.authority_type=? AND upper(da.status)<>'REVOKED'
      AND datetime('now')>=datetime(da.effective_from) AND datetime('now')<datetime(da.effective_until)
      ORDER BY da.effective_until""",(user['employee_id'],authority_code))
    expected_department=AUTHORITIES[authority_code][0]
    return next((row for row in rows if row.get('department')==expected_department and scope_matches(row,scope_type,scope_id,warehouse_id)),None)

def record_delegated_use(connection,delegation,user,table_name,record_id,action,context=None):
    connection.execute("""INSERT INTO delegated_authority_uses(delegation_id,authority_code,performed_by,table_name,record_id,action,normal_role,delegated_by_employee_id,context_json)
      VALUES(?,?,?,?,?,?,?,?,?)""",(delegation['id'],delegation['authority_type'],user['id'],table_name,record_id,action,user['role'],delegation['delegator_employee_id'],json.dumps(context or {})))
    return {'authorization_source':'Delegated Authority','delegation_id':delegation['id'],'delegation_number':delegation['delegation_number'],'delegated_authority':delegation['authority_type'],'delegated_by':delegation.get('delegated_by_name')}
