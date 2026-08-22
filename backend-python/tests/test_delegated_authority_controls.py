import sqlite3,shutil
from datetime import datetime,timedelta,timezone
import pytest
from fastapi.testclient import TestClient
from app import database
from app.database import ensure_company_employee_schema
from app.delegated_authority import active_delegation,record_delegated_use
from app.main import app
from app.security import sign_token

def setup(tmp_path,monkeypatch):
    path=tmp_path/'delegations.db';shutil.copy2(database.DB_PATH,path);monkeypatch.setattr(database,'DB_PATH',path);ensure_company_employee_schema();return path,TestClient(app)
def auth(path,role):
    with sqlite3.connect(path)as c:row=c.execute("SELECT id FROM users WHERE role=? AND is_active=1 AND deleted_at IS NULL LIMIT 1",(role,)).fetchone()
    if not row:pytest.skip(f'No active {role} fixture')
    return {'Authorization':f'Bearer {sign_token({"id":row[0]})}'},row[0]
def period(hours_from=0,hours_until=24):
    now=datetime.now(timezone.utc).replace(tzinfo=None);return (now+timedelta(hours=hours_from)).isoformat(timespec='minutes'),(now+timedelta(hours=hours_until)).isoformat(timespec='minutes')
def payload(employee,authority,scope):
    start,end=period();return {'delegate_employee_id':employee['id'],'authority_code':authority,'scope_type':scope,'effective_from':start,'effective_until':end,'reason_code':'ANNUAL_LEAVE','business_justification':'Controlled temporary operational coverage during annual leave.','broad_scope_confirmed':True}

@pytest.mark.parametrize('role',['PurchaseManager','PurchaseOfficer','WarehouseManager','WarehouseSupervisor','Storekeeper'])
def test_only_supply_chain_manager_can_administer(tmp_path,monkeypatch,role):
    path,client=setup(tmp_path,monkeypatch);headers,_=auth(path,role)
    assert client.get('/api/delegations',headers=headers).status_code==403
    assert client.get('/api/delegations/catalog',headers=headers).status_code==403
    assert client.get('/api/delegations/eligible-employees',headers=headers).status_code==403
    assert client.post('/api/delegations',headers=headers,json={}).status_code==403

def test_department_separation_role_preservation_lifecycle_and_audit(tmp_path,monkeypatch):
    path,client=setup(tmp_path,monkeypatch);manager_headers,manager_id=auth(path,'SupplyChainManager')
    eligible=client.get('/api/delegations/eligible-employees',headers=manager_headers).json();proc=next(e for e in eligible if e['department']=='Procurement');warehouse=next(e for e in eligible if e['department']=='Warehouse')
    before_role=proc['approval_role']
    wrong=client.post('/api/delegations',headers=manager_headers,json=payload(proc,'WH_TRANSFER','ALL_ASSIGNED_WAREHOUSES'));assert wrong.status_code==403
    wrong=client.post('/api/delegations',headers=manager_headers,json=payload(warehouse,'PROC_PO_APPROVE','ALL_AUTHORIZED_PROCUREMENT'));assert wrong.status_code==403
    created=client.post('/api/delegations',headers=manager_headers,json=payload(proc,'PROC_PO_APPROVE','ALL_AUTHORIZED_PROCUREMENT'));assert created.status_code==201,created.text
    delegation_id=created.json()['id']
    with sqlite3.connect(path)as c:
        assert c.execute('SELECT approval_role FROM employees WHERE id=?',(proc['id'],)).fetchone()[0]==before_role
        assert c.execute("SELECT COUNT(*) FROM delegated_authority_history WHERE delegation_id=? AND event_type='CREATED'",(delegation_id,)).fetchone()[0]==1
    proc_headers,proc_user_id=auth(path,proc['approval_role']);mine=client.get('/api/delegations/mine',headers=proc_headers);assert mine.status_code==200 and any(row['id']==delegation_id for row in mine.json())
    duplicate=client.post('/api/delegations',headers=manager_headers,json=payload(proc,'PROC_PO_APPROVE','ALL_AUTHORIZED_PROCUREMENT'));assert duplicate.status_code==409
    revoked=client.put(f'/api/delegations/{delegation_id}/revoke',headers=manager_headers,json={'reason':'Coverage is no longer required'});assert revoked.status_code==200
    with sqlite3.connect(path)as c:assert c.execute('SELECT status FROM delegated_authorities WHERE id=?',(delegation_id,)).fetchone()[0]=='REVOKED'

def test_time_and_scope_checked_at_authorization_time(tmp_path,monkeypatch):
    path,client=setup(tmp_path,monkeypatch);headers,_=auth(path,'SupplyChainManager');employee=next(e for e in client.get('/api/delegations/eligible-employees',headers=headers).json()if e['department']=='Warehouse');employee_headers,user_id=auth(path,employee['approval_role'])
    with sqlite3.connect(path)as c:
        warehouse_ids=[r[0]for r in c.execute('SELECT id FROM warehouses WHERE deleted_at IS NULL ORDER BY id LIMIT 2')]
        if len(warehouse_ids)<2:pytest.skip('Two warehouses required for scope test')
        scm_employee=c.execute("SELECT employee_id FROM users WHERE role='SupplyChainManager' AND is_active=1 LIMIT 1").fetchone()[0];start,end=period(-1,2)
        delegation_id=c.execute("INSERT INTO delegated_authorities(delegation_number,delegator_employee_id,delegate_employee_id,delegate_role,employee_role_snapshot,department,authority_type,scope_type,scope_id,effective_from,effective_until,reason,reason_code,business_justification,status,created_by)VALUES('DEL-TEST-SCOPE',?,?,?,?,?,'WH_TRANSFER','WAREHOUSE',?,?,?,?,?,'test','ACTIVE',?)",(scm_employee,employee['id'],employee['approval_role'],employee['approval_role'],'Warehouse',warehouse_ids[0],start,end,'Operational Requirement','OPERATIONAL_REQUIREMENT',user_id)).lastrowid;c.commit()
    user={'id':user_id,'employee_id':employee['id'],'role':employee['approval_role']}
    assert active_delegation(user,'WH_TRANSFER',warehouse_id=warehouse_ids[0])
    assert active_delegation(user,'WH_TRANSFER',warehouse_id=warehouse_ids[1])is None
    assert active_delegation(user,'WH_GRN_RECEIVE',warehouse_id=warehouse_ids[0])is None
    with database.transaction(immediate=True)as c:record_delegated_use(c,active_delegation(user,'WH_TRANSFER',warehouse_id=warehouse_ids[0]),user,'transfers',1,'CREATE')
    with sqlite3.connect(path)as c:assert c.execute('SELECT authority_code FROM delegated_authority_uses WHERE delegation_id=?',(delegation_id,)).fetchone()[0]=='WH_TRANSFER'
