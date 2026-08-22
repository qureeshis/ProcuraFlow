import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from app import database,tenancy
from app.main import app


def setup_tenants(tmp_path,monkeypatch):
    source=tmp_path/'source.db'
    source.write_bytes(Path(database.DB_PATH).read_bytes())
    monkeypatch.setattr(database,'DB_PATH',source)
    monkeypatch.setattr(tenancy,'TENANT_ROOT',tmp_path/'tenants')
    monkeypatch.setattr(tenancy,'REGISTRY_PATH',tmp_path/'tenants'/'tenant-registry.db')
    return TestClient(app)


def registration(key,name):
    return {'company_key':key,'company_name':name,'company_email':f'admin@{key}.test','admin_name':f'{name} Administrator','admin_email':f'admin@{key}.test','username':'admin','password':'Secure-Tenant-Password-123!'}


def test_company_registration_login_and_database_isolation(tmp_path,monkeypatch):
    client=setup_tenants(tmp_path,monkeypatch)
    for key,name in [('alpha-precast','Alpha Precast'),('beta-precast','Beta Precast')]:
        created=client.post('/api/auth/register-company',json=registration(key,name))
        assert created.status_code==201,created.text
        signed_in=client.post('/api/auth/login',json={'company_key':key,'username':'admin','password':'Secure-Tenant-Password-123!'},headers={'X-Company-Key':key})
        assert signed_in.status_code==200,signed_in.text
        assert signed_in.json()['user']['tenant_key']==key
        token=signed_in.json()['token']
        me=client.get('/api/auth/me',headers={'Authorization':f'Bearer {token}','X-Company-Key':key})
        assert me.status_code==200 and me.json()['tenant_key']==key
        mismatch=client.get('/api/auth/me',headers={'Authorization':f'Bearer {token}','X-Company-Key':'beta-precast'if key=='alpha-precast'else'alpha-precast'})
        assert mismatch.status_code==401
    alpha=tenancy.tenant_record('alpha-precast');beta=tenancy.tenant_record('beta-precast')
    with sqlite3.connect(alpha['database_path'])as connection:
        assert connection.execute('SELECT name FROM company').fetchone()[0]=='Alpha Precast'
        connection.execute("INSERT INTO suppliers(supplier_code,name)VALUES('SUP-SECRET','Alpha Secret Supplier')");connection.commit()
    with sqlite3.connect(beta['database_path'])as connection:
        assert connection.execute('SELECT name FROM company').fetchone()[0]=='Beta Precast'
        assert connection.execute("SELECT COUNT(*) FROM suppliers WHERE supplier_code='SUP-SECRET'").fetchone()[0]==0
