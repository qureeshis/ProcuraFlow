import shutil
import sqlite3

from fastapi.testclient import TestClient

from app import database
from app.main import app
from app.security import sign_token


def setup_copy(tmp_path,monkeypatch):
    path=tmp_path/'holiday-calendar.db';shutil.copy2(database.DB_PATH,path);monkeypatch.setattr(database,'DB_PATH',path)
    with sqlite3.connect(path)as c:
        c.row_factory=sqlite3.Row
        manager=c.execute("SELECT id FROM users WHERE role='SupplyChainManager' AND is_active=1 AND deleted_at IS NULL LIMIT 1").fetchone()['id']
        officer=c.execute("SELECT id FROM users WHERE role='PurchaseOfficer' AND is_active=1 AND deleted_at IS NULL LIMIT 1").fetchone()['id']
        country=c.execute('SELECT country_code FROM countries WHERE active_yn=1 ORDER BY country_code LIMIT 1').fetchone()['country_code']
    return path,TestClient(app),{'Authorization':f"Bearer {sign_token({'id':manager})}"},{'Authorization':f"Bearer {sign_token({'id':officer})}"},country


def test_country_region_observed_holiday_flows_to_applicable_employee_calendar(tmp_path,monkeypatch):
    path,client,manager,officer,country=setup_copy(tmp_path,monkeypatch)
    warehouse=client.post('/api/masters/warehouses',headers=manager,json={'warehouse_code':'HOL-WH','name':'Holiday Region Warehouse','country_code':country,'region_province':'Test Region','time_zone':'America/Toronto','operating_days':[0,1,2,3,4,5,6],'operating_start_time':'07:00','operating_end_time':'19:00'})
    assert warehouse.status_code==201,warehouse.text
    warehouse_id=warehouse.json()['id']
    with sqlite3.connect(path)as c:
        department=c.execute("SELECT id FROM departments WHERE lower(name)='warehouse' AND deleted_at IS NULL LIMIT 1").fetchone()[0]
        employee=c.execute("INSERT INTO employees(employee_code,name,department_id,warehouse_id,approval_role,status,system_access_yn)VALUES('HOL-EMP','Holiday Employee',?,?,?,'Active',0)",(department,warehouse_id,'Helper')).lastrowid
    denied=client.post('/api/workforce/holidays',headers=officer,json={'country_code':country,'holiday_name':'Denied Holiday','holiday_date':'2032-09-22','holiday_type':'Government Public Holiday'})
    assert denied.status_code==403
    created=client.post('/api/workforce/holidays',headers=manager,json={'country_code':country,'region':'Test Region','holiday_name':'Observed Regional Day','holiday_date':'2032-09-22','observed_date':'2032-09-23','holiday_type':'Special Government Holiday','government_yn':1,'source':'Government notice'})
    assert created.status_code==201,created.text
    holiday_id=created.json()['id']
    duplicate=client.post('/api/workforce/holidays',headers=manager,json={'country_code':country,'region':'Test Region','holiday_name':'Observed Regional Day','holiday_date':'2032-09-22','observed_date':'2032-09-23','holiday_type':'Special Government Holiday'})
    assert duplicate.status_code==409
    with sqlite3.connect(path)as c:
        row=c.execute('SELECT day_type,holiday_id,warehouse_time_zone,remarks FROM employee_work_calendar WHERE employee_id=? AND calendar_date=?',(employee,'2032-09-23')).fetchone()
        official=c.execute('SELECT observed_date,calendar_year,region FROM holidays WHERE id=?',(holiday_id,)).fetchone()
        audit=c.execute("SELECT COUNT(*) FROM audit_log WHERE table_name='holidays' AND record_id=? AND action='CREATE'",(holiday_id,)).fetchone()[0]
    assert row[0]=='HOLIDAY'and row[1]==holiday_id and row[2]=='America/Toronto'and'PUBLIC HOLIDAY'in row[3]
    assert official==('2032-09-23',2032,'Test Region')and audit==1


def test_invalid_timezone_and_closed_operating_day_are_enforced(tmp_path,monkeypatch):
    path,client,manager,_officer,country=setup_copy(tmp_path,monkeypatch)
    invalid=client.post('/api/masters/warehouses',headers=manager,json={'warehouse_code':'BAD-TZ','name':'Invalid TZ Warehouse','country_code':country,'time_zone':'Not/AZone','operating_days':[0],'operating_start_time':'08:00','operating_end_time':'17:00'})
    assert invalid.status_code==400
    valid=client.post('/api/masters/warehouses',headers=manager,json={'warehouse_code':'DAY-WH','name':'Day Schedule Warehouse','country_code':country,'time_zone':'Asia/Riyadh','operating_days':[0,1,2,3,4],'operating_start_time':'08:00','operating_end_time':'17:00','operating_schedule':[{'weekday':4,'is_open':1,'open_time':'08:00','close_time':'15:00'},{'weekday':5,'is_open':0}]})
    assert valid.status_code==201,valid.text
    with sqlite3.connect(path)as c:
        schedules=c.execute('SELECT weekday,is_open,open_time,close_time FROM warehouse_operating_schedules WHERE warehouse_id=? ORDER BY weekday',(valid.json()['id'],)).fetchall()
    assert schedules[4]==(4,1,'08:00','15:00')and schedules[5]==(5,0,None,None)
