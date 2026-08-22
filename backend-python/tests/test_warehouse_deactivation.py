import shutil,sqlite3
from fastapi.testclient import TestClient
from app import database
from app.main import app
from app.security import sign_token

def setup(tmp_path,monkeypatch):
    path=tmp_path/'warehouse-deactivation.db';shutil.copy2(database.DB_PATH,path);monkeypatch.setattr(database,'DB_PATH',path)
    with sqlite3.connect(path)as c:
        manager=c.execute("SELECT id FROM users WHERE role='SupplyChainManager' AND is_active=1 AND deleted_at IS NULL LIMIT 1").fetchone()[0]
        officer=c.execute("SELECT id FROM users WHERE role='PurchaseOfficer' AND is_active=1 AND deleted_at IS NULL LIMIT 1").fetchone()[0]
    client=TestClient(app);return path,client,{'Authorization':f"Bearer {sign_token({'id':manager})}"},{'Authorization':f"Bearer {sign_token({'id':officer})}"}

def test_deactivation_blocks_open_work_then_retains_complete_report_and_audit(tmp_path,monkeypatch):
    path,client,manager,officer=setup(tmp_path,monkeypatch)
    created=client.post('/api/masters/warehouses',headers=manager,json={'warehouse_code':'DEACT-WH','name':'Deactivation Test Warehouse','time_zone':'Asia/Riyadh','operating_start_time':'08:00','operating_end_time':'17:00','shifts_enabled_yn':0})
    assert created.status_code==201,created.text;warehouse_id=created.json()['id']
    with sqlite3.connect(path)as c:
        item_id=c.execute('SELECT id FROM items WHERE deleted_at IS NULL ORDER BY id LIMIT 1').fetchone()[0]
        c.execute('INSERT INTO inventory_stock(item_id,warehouse_id,quantity)VALUES(?,?,?)',(item_id,warehouse_id,5))
        c.execute("INSERT INTO stock_adjustments(adjustment_number,item_id,warehouse_id,quantity_change,reason,status)VALUES('DEACT-ADJ',?,?,1,'Test','Pending')",(item_id,warehouse_id))
    denied=client.get(f'/api/masters/warehouses/{warehouse_id}/deactivation-readiness',headers=officer)
    assert denied.status_code==403
    readiness=client.get(f'/api/masters/warehouses/{warehouse_id}/deactivation-readiness',headers=manager)
    assert readiness.status_code==200,readiness.text;body=readiness.json();assert body['ready']is False
    assert {'Stock Balance Must Be Zero','Pending Stock Adjustments'}<={task['category']for task in body['open_tasks']}
    blocked=client.post(f'/api/masters/warehouses/{warehouse_id}/deactivate',headers=manager,json={'reason':'Facility closure'})
    assert blocked.status_code==409
    with sqlite3.connect(path)as c:
        assert c.execute('SELECT deleted_at FROM warehouses WHERE id=?',(warehouse_id,)).fetchone()[0]is None
        assert c.execute('SELECT COUNT(*) FROM warehouse_deactivation_reports WHERE warehouse_id=?',(warehouse_id,)).fetchone()[0]==0
        c.execute('UPDATE inventory_stock SET quantity=0 WHERE warehouse_id=?',(warehouse_id,));c.execute("UPDATE stock_adjustments SET status='Rejected' WHERE warehouse_id=?",(warehouse_id,))
    completed=client.post(f'/api/masters/warehouses/{warehouse_id}/deactivate',headers=manager,json={'reason':'Facility permanently closed'})
    assert completed.status_code==200,completed.text;report_id=completed.json()['report_id']
    report=client.get(f'/api/masters/warehouses/deactivation-reports/{report_id}',headers=manager)
    assert report.status_code==200,report.text;payload=report.json();assert payload['snapshot']['readiness']['ready']is True
    assert payload['snapshot']['reports']['adjustments'][0]['status']=='Rejected'
    with sqlite3.connect(path)as c:
        assert c.execute('SELECT deleted_at FROM warehouses WHERE id=?',(warehouse_id,)).fetchone()[0]is not None
        assert c.execute('SELECT COUNT(*) FROM stock_adjustments WHERE warehouse_id=?',(warehouse_id,)).fetchone()[0]==1
        assert c.execute("SELECT COUNT(*) FROM audit_log WHERE table_name='warehouses' AND record_id=? AND action='DELETE'",(warehouse_id,)).fetchone()[0]==1
    assert client.get('/api/masters/warehouses/deactivation-reports',headers=officer).status_code==403

def test_disabled_shift_modes_are_hidden_from_workforce_setup(tmp_path,monkeypatch):
    _path,client,manager,_officer=setup(tmp_path,monkeypatch)
    created=client.post('/api/masters/warehouses',headers=manager,json={'warehouse_code':'NO-SHIFT','name':'No Shift Warehouse','time_zone':'Asia/Riyadh','operating_start_time':'07:00','operating_end_time':'15:00','shifts_enabled_yn':0})
    assert created.status_code==201,created.text;warehouse_id=created.json()['id']
    disabled=client.put('/api/workforce/shift-mode/procurement',headers=manager,json={'shifts_enabled_yn':0,'operating_start_time':'08:00','operating_end_time':'17:00','operating_days':[0,1,2,3,4]})
    assert disabled.status_code==200,disabled.text
    reference=client.get('/api/workforce/reference',headers=manager)
    assert reference.status_code==200,reference.text
    assert all(row.get('warehouse_id')!=warehouse_id for row in reference.json()['shifts'])
    assert all(row.get('warehouse_id')is not None for row in reference.json()['shifts'])
    with sqlite3.connect(database.DB_PATH)as c:
        assert c.execute("SELECT COUNT(*) FROM shifts WHERE warehouse_id=? AND schedule_mode='STANDARD' AND active_yn=1",(warehouse_id,)).fetchone()[0]==1

def test_delete_uses_controlled_deactivation_and_inactive_legacy_scope_is_denied(tmp_path,monkeypatch):
    path,client,manager,_officer=setup(tmp_path,monkeypatch)
    created=client.post('/api/masters/warehouses',headers=manager,json={'warehouse_code':'DELETE-WH','name':'Delete Rule Warehouse','time_zone':'Asia/Riyadh','operating_start_time':'08:00','operating_end_time':'16:00','shifts_enabled_yn':0})
    assert created.status_code==201,created.text;warehouse_id=created.json()['id']
    with sqlite3.connect(path)as c:
        operator=c.execute("SELECT id FROM users WHERE role IN('WarehouseManager','WarehouseSupervisor','Storekeeper') AND is_active=1 AND deleted_at IS NULL LIMIT 1").fetchone()[0]
        c.execute('UPDATE user_warehouse_assignments SET is_active=0 WHERE user_id=?',(operator,));c.execute('UPDATE users SET warehouse_id=? WHERE id=?',(warehouse_id,operator))
    operator_headers={'Authorization':f"Bearer {sign_token({'id':operator})}"}
    removed=client.request('DELETE',f'/api/masters/warehouses/{warehouse_id}',headers=manager,json={'reason':'Controlled warehouse deletion request'})
    assert removed.status_code==200,removed.text
    assert all(row['id']!=warehouse_id for row in client.get('/api/masters/warehouses',headers=manager).json())
    assert client.post('/api/warehouse/returns',headers=operator_headers,json={'warehouse_id':warehouse_id}).status_code==403
    with sqlite3.connect(path)as c:
        assert c.execute('SELECT deleted_at FROM warehouses WHERE id=?',(warehouse_id,)).fetchone()[0]
        assert c.execute('SELECT COUNT(*) FROM warehouse_deactivation_reports WHERE warehouse_id=?',(warehouse_id,)).fetchone()[0]==1
