import shutil
import sqlite3
from datetime import datetime,timezone

from fastapi.testclient import TestClient

from app import backup_service,database
from app.main import app
from app.security import sign_token


def setup_copy(tmp_path,monkeypatch,name):
    path=tmp_path/name;shutil.copy2(database.DB_PATH,path);monkeypatch.setattr(database,'DB_PATH',path);folder=tmp_path/'backups';folder.mkdir();monkeypatch.setattr(backup_service,'BACKUPS',folder)
    with sqlite3.connect(path)as c:user=c.execute("SELECT id FROM users WHERE role='SupplyChainManager' AND is_active=1 AND deleted_at IS NULL LIMIT 1").fetchone()[0]
    return path,TestClient(app),user,folder


def test_last_day_calculation_and_warning_sequence_are_idempotent(tmp_path,monkeypatch):
    path,_client,_user,_folder=setup_copy(tmp_path,monkeypatch,'warning.db')
    with database.transaction(immediate=True)as c:
        c.execute("UPDATE settings SET value='UTC' WHERE key='backup_time_zone'");c.execute("UPDATE settings SET value='16:00' WHERE key='backup_time'")
    expected=[(datetime(2031,1,15,tzinfo=timezone.utc),31),(datetime(2031,4,1,tzinfo=timezone.utc),30),(datetime(2031,2,1,tzinfo=timezone.utc),28),(datetime(2032,2,1,tzinfo=timezone.utc),29)]
    for now,day in expected:assert backup_service.backup_schedule(now)['scheduled_utc'].day==day
    for minute in (30,40,50):backup_service.scheduler_tick(datetime(2031,1,31,15,minute,tzinfo=timezone.utc))
    backup_service.scheduler_tick(datetime(2031,1,31,15,50,tzinfo=timezone.utc))
    with sqlite3.connect(path)as c:
        cycle=c.execute("SELECT warning_30_at,warning_20_at,warning_10_at FROM backup_cycles WHERE cycle_id='2031-01-MONTH-END'").fetchone()
        keys=c.execute("SELECT event_key,COUNT(*) FROM notifications WHERE event_key LIKE '2031-01-MONTH-END:%' GROUP BY event_key").fetchall()
    assert all(cycle)and keys and all(count>=1 for _key,count in keys)


def test_verified_backup_invalidates_old_session_blocks_writes_and_prevents_duplicate(tmp_path,monkeypatch):
    path,client,user,folder=setup_copy(tmp_path,monkeypatch,'success.db');token=sign_token({'id':user});headers={'Authorization':f'Bearer {token}'}
    schedule=backup_service.backup_schedule(datetime(2031,3,31,16,0,tzinfo=timezone.utc));result=backup_service.execute_month_end_backup(schedule)
    assert result['status']=='COMPLETED'
    backup=folder/result['backup_reference'];assert backup.exists()
    with sqlite3.connect(backup)as c:assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'and not c.execute('PRAGMA foreign_key_check').fetchall()
    assert client.get('/api/auth/me',headers=headers).status_code==401
    duplicate=backup_service.execute_month_end_backup(schedule);assert duplicate['duplicate_prevented']and len(list(folder.glob('*.db')))==1
    with sqlite3.connect(path)as c:assert c.execute('SELECT active_yn,result FROM system_maintenance WHERE id=1').fetchone()==(0,'SUCCESS')


def test_maintenance_denies_login_and_writes_and_failure_is_not_success(tmp_path,monkeypatch):
    path,client,user,folder=setup_copy(tmp_path,monkeypatch,'failure.db');headers={'Authorization':f"Bearer {sign_token({'id':user})}"}
    with database.transaction(immediate=True)as c:c.execute("UPDATE system_maintenance SET active_yn=1,reason='Month-End Backup in Progress',session_epoch=session_epoch+1 WHERE id=1")
    assert client.post('/api/masters/item-taxonomy/categories',headers=headers,json={'name':'Blocked Write'}).status_code==503
    assert client.post('/api/auth/login',json={'username':'anything','password':'anything'}).status_code==503
    with database.transaction(immediate=True)as c:c.execute('UPDATE system_maintenance SET active_yn=0 WHERE id=1')
    schedule=backup_service.backup_schedule(datetime(2031,5,31,16,0,tzinfo=timezone.utc));result=backup_service.execute_month_end_backup(schedule,fail_for_test=True)
    assert result['status']=='FAILED'and not list(folder.glob('*.db'))
    with sqlite3.connect(path)as c:
        state=c.execute('SELECT active_yn,result FROM system_maintenance WHERE id=1').fetchone();cycle=c.execute('SELECT status,verification_result FROM backup_cycles WHERE cycle_id=?',(schedule['cycle_id'],)).fetchone()
    assert state==(0,'FAILED')and cycle==('FAILED','FAILED')
