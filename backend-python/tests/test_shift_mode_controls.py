import shutil,sqlite3
from fastapi.testclient import TestClient
from app import database
from app.main import app
from app.security import sign_token

def setup(tmp_path,monkeypatch):
    path=tmp_path/'shift-modes.db';shutil.copy2(database.DB_PATH,path);monkeypatch.setattr(database,'DB_PATH',path)
    with sqlite3.connect(path)as c:
        c.row_factory=sqlite3.Row;manager=c.execute("SELECT id FROM users WHERE role='SupplyChainManager' AND is_active=1 AND deleted_at IS NULL LIMIT 1").fetchone()['id']
    return path,TestClient(app),{'Authorization':f"Bearer {sign_token({'id':manager})}"}

def test_procurement_switches_between_saved_multi_shifts_and_standard_hours(tmp_path,monkeypatch):
    path,client,headers=setup(tmp_path,monkeypatch)
    with sqlite3.connect(path)as c:before=c.execute("SELECT id,start_time,end_time FROM shifts WHERE warehouse_id IS NULL AND schedule_mode='MULTI' ORDER BY id").fetchall()
    disabled=client.put('/api/workforce/shift-mode/procurement',headers=headers,json={'shifts_enabled_yn':0,'operating_start_time':'07:30','operating_end_time':'16:30','operating_days':[0,1,2,3,4]})
    assert disabled.status_code==200,disabled.text
    with sqlite3.connect(path)as c:
        active=c.execute("SELECT start_time,end_time,schedule_mode FROM shifts WHERE warehouse_id IS NULL AND active_yn=1").fetchall()
        saved=c.execute("SELECT id,start_time,end_time FROM shifts WHERE warehouse_id IS NULL AND schedule_mode='MULTI' ORDER BY id").fetchall()
    assert active==[('07:30','17:00','STANDARD')];assert saved==before
    enabled=client.put('/api/workforce/shift-mode/procurement',headers=headers,json={'shifts_enabled_yn':1,'operating_start_time':'07:30','operating_end_time':'16:30','operating_days':[0,1,2,3,4]})
    assert enabled.status_code==200,enabled.text
    with sqlite3.connect(path)as c:assert c.execute("SELECT COUNT(*) FROM shifts WHERE warehouse_id IS NULL AND schedule_mode='MULTI' AND active_yn=1").fetchone()[0]==len(before)

def test_warehouse_switch_retains_multi_templates_and_uses_operating_window(tmp_path,monkeypatch):
    path,client,headers=setup(tmp_path,monkeypatch)
    created=client.post('/api/masters/warehouses',headers=headers,json={'warehouse_code':'MODE-WH','name':'Mode Warehouse','time_zone':'Asia/Riyadh','operating_start_time':'06:00','operating_end_time':'20:00','shifts_enabled_yn':1})
    assert created.status_code==201,created.text;warehouse_id=created.json()['id']
    with sqlite3.connect(path)as c:before=c.execute("SELECT id,start_time,end_time FROM shifts WHERE warehouse_id=? AND schedule_mode='MULTI' ORDER BY id",(warehouse_id,)).fetchall()
    disabled=client.put(f'/api/masters/warehouses/{warehouse_id}',headers=headers,json={'shifts_enabled_yn':0})
    assert disabled.status_code==200,disabled.text
    with sqlite3.connect(path)as c:
        active=c.execute("SELECT start_time,end_time,schedule_mode FROM shifts WHERE warehouse_id=? AND active_yn=1",(warehouse_id,)).fetchall()
        saved=c.execute("SELECT id,start_time,end_time FROM shifts WHERE warehouse_id=? AND schedule_mode='MULTI' ORDER BY id",(warehouse_id,)).fetchall()
    assert active==[('06:00','20:00','STANDARD')];assert saved==before
    enabled=client.put(f'/api/masters/warehouses/{warehouse_id}',headers=headers,json={'shifts_enabled_yn':1})
    assert enabled.status_code==200,enabled.text
    with sqlite3.connect(path)as c:assert c.execute("SELECT COUNT(*) FROM shifts WHERE warehouse_id=? AND schedule_mode='MULTI' AND active_yn=1",(warehouse_id,)).fetchone()[0]==len(before)

def test_batch_shift_confirmation_is_atomic_and_rejects_gaps(tmp_path,monkeypatch):
    path,client,headers=setup(tmp_path,monkeypatch)
    enabled=client.put('/api/workforce/shift-mode/procurement',headers=headers,json={'shifts_enabled_yn':1,'operating_start_time':'08:00','operating_end_time':'17:00','operating_days':[0,1,2,3,4]})
    assert enabled.status_code==200,enabled.text
    with sqlite3.connect(path)as c:
        c.row_factory=sqlite3.Row;shifts=[dict(row)for row in c.execute("SELECT id,start_time,end_time FROM shifts WHERE warehouse_id IS NULL AND active_yn=1 ORDER BY start_time,id")]
    assert len(shifts)==3
    invalid=client.put('/api/workforce/shifts/batch',headers=headers,json={'shifts':[{'id':shifts[0]['id'],'start_time':'04:00','end_time':'12:30'}]})
    assert invalid.status_code==409
    assert 'no changes were saved' in invalid.json()['error']
    with sqlite3.connect(path)as c:assert c.execute('SELECT start_time,end_time FROM shifts WHERE id=?',(shifts[0]['id'],)).fetchone()==(shifts[0]['start_time'],shifts[0]['end_time'])
    def plus_hour(value):
        hour,minute=map(int,value.split(':'));return f'{(hour+1)%24:02d}:{minute:02d}'
    changes=[{'id':row['id'],'start_time':plus_hour(row['start_time']),'end_time':plus_hour(row['end_time']),'break_minutes':30}for row in shifts]
    accepted=client.put('/api/workforce/shifts/batch',headers=headers,json={'shifts':changes})
    assert accepted.status_code==200,accepted.text
    assert accepted.json()['continuous_coverage']is True
    with sqlite3.connect(path)as c:
        stored=c.execute("SELECT start_time,end_time FROM shifts WHERE warehouse_id IS NULL AND active_yn=1 ORDER BY start_time,id").fetchall()
    assert set(stored)=={(item['start_time'],item['end_time'])for item in changes}
