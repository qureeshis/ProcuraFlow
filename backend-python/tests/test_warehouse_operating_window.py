import shutil
import sqlite3

from fastapi.testclient import TestClient

from app import database
from app.main import app
from app.security import sign_token
from app.routes.masters import automatic_shift_design

def test_24_hour_window_uses_four_shifts_ending_at_operating_close():
    design=automatic_shift_design('00:00',1440)
    assert [(row['start_time'],row['end_time'])for row in design]==[('00:00','08:30'),('05:00','13:30'),('10:30','19:00'),('15:30','00:00')]
    assert [row['shift_label']for row in design]==['First Shift','Second Shift','Third Shift','Night Shift']
    assert all(row['working_minutes']==480 for row in design)
    assert all(row['scheduled_minutes']==510 for row in design)
    assert all(row['start_time'].endswith((':00',':30'))for row in design)


def test_warehouse_creation_builds_its_own_gapless_shift_window(tmp_path, monkeypatch):
    test_database=tmp_path/'warehouse-window.db';shutil.copy2(database.DB_PATH,test_database);monkeypatch.setattr(database,'DB_PATH',test_database)
    with sqlite3.connect(test_database)as connection:
        user_id=connection.execute("SELECT id FROM users WHERE role='SupplyChainManager' AND is_active=1 AND deleted_at IS NULL LIMIT 1").fetchone()[0]
        global_before=connection.execute('SELECT start_time,end_time FROM shifts WHERE warehouse_id IS NULL AND active_yn=1 ORDER BY start_time').fetchall()
    client=TestClient(app);headers={'Authorization':f"Bearer {sign_token({'id':user_id})}"}
    response=client.post('/api/masters/warehouses',headers=headers,json={'warehouse_code':'WH-WINDOW','name':'Window Test Warehouse','site_type':'Factory','time_zone':'Asia/Riyadh','operating_start_time':'06:00','operating_end_time':'22:00'})
    assert response.status_code==201,response.text
    warehouse=response.json();assert warehouse['operating_start_time']=='06:00';assert warehouse['operating_end_time']=='22:00'
    with sqlite3.connect(test_database)as connection:
        shifts=connection.execute('SELECT start_time,end_time FROM shifts WHERE warehouse_id=? AND active_yn=1 ORDER BY start_time',(warehouse['id'],)).fetchall()
    assert shifts==[('06:00','14:30'),('10:00','18:30'),('13:30','22:00')]

    updated=client.put(f"/api/masters/warehouses/{warehouse['id']}",headers=headers,json={'operating_start_time':'08:00','operating_end_time':'00:00'})
    assert updated.status_code==409
    preview=client.post(f"/api/masters/warehouses/{warehouse['id']}/shift-design-preview",headers=headers,json={'operating_start_time':'08:00','operating_end_time':'00:00'})
    assert preview.status_code==200,preview.text;assert len(preview.json()['proposed_shifts'])==3
    updated=client.put(f"/api/masters/warehouses/{warehouse['id']}",headers=headers,json={'operating_start_time':'08:00','operating_end_time':'00:00','confirm_shift_design':True})
    assert updated.status_code==200,updated.text
    with sqlite3.connect(test_database)as connection:
        shifted=connection.execute('SELECT start_time,end_time FROM shifts WHERE warehouse_id=? AND active_yn=1 ORDER BY start_time',(warehouse['id'],)).fetchall()
        global_shifts=connection.execute('SELECT start_time,end_time FROM shifts WHERE warehouse_id IS NULL AND active_yn=1 ORDER BY start_time').fetchall()
    assert shifted==[('08:00','16:30'),('12:00','20:30'),('15:30','00:00')]
    assert global_shifts==global_before


def test_warehouse_window_uses_actual_duration_and_shortens_final_shift(tmp_path,monkeypatch):
    test_database=tmp_path/'warehouse-window-specific.db';shutil.copy2(database.DB_PATH,test_database);monkeypatch.setattr(database,'DB_PATH',test_database)
    with sqlite3.connect(test_database)as connection:user_id=connection.execute("SELECT id FROM users WHERE role='SupplyChainManager' AND is_active=1 AND deleted_at IS NULL LIMIT 1").fetchone()[0]
    response=TestClient(app).post('/api/masters/warehouses',headers={'Authorization':f"Bearer {sign_token({'id':user_id})}"},json={'warehouse_code':'WH-BAD-WINDOW','name':'Bad Window','time_zone':'Asia/Riyadh','operating_start_time':'06:00','operating_end_time':'21:00'})
    assert response.status_code==201,response.text
    warehouse=response.json()
    with sqlite3.connect(test_database)as connection:
        shifts=connection.execute('SELECT start_time,end_time,break_minutes FROM shifts WHERE warehouse_id=? AND active_yn=1 ORDER BY id',(warehouse['id'],)).fetchall()
    assert shifts==[('06:00','14:30',30),('12:30','21:00',30)]


def test_cross_midnight_specific_window_is_gapless(tmp_path,monkeypatch):
    test_database=tmp_path/'warehouse-window-overnight.db';shutil.copy2(database.DB_PATH,test_database);monkeypatch.setattr(database,'DB_PATH',test_database)
    with sqlite3.connect(test_database)as connection:user_id=connection.execute("SELECT id FROM users WHERE role='SupplyChainManager' AND is_active=1 AND deleted_at IS NULL LIMIT 1").fetchone()[0]
    client=TestClient(app);headers={'Authorization':f"Bearer {sign_token({'id':user_id})}"}
    response=client.post('/api/masters/warehouses',headers=headers,json={'warehouse_code':'WH-OVERNIGHT','name':'Overnight Warehouse','time_zone':'America/Toronto','operating_start_time':'20:00','operating_end_time':'05:00'})
    assert response.status_code==201,response.text
    warehouse=response.json()
    with sqlite3.connect(test_database)as connection:
        shifts=connection.execute('SELECT start_time,end_time,break_minutes FROM shifts WHERE warehouse_id=? AND active_yn=1 ORDER BY id',(warehouse['id'],)).fetchall()
    assert shifts==[('20:00','04:30',30),('20:30','05:00',30)]


def test_main_warehouse_window_aligns_final_shift_to_2200():
    design=automatic_shift_design('08:00',840)
    assert [(row['start_time'],row['end_time'])for row in design]==[('08:00','16:30'),('13:30','22:00')]
