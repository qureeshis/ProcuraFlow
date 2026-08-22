import shutil
import sqlite3

from app import database
from app.routes.warehouse import refresh_supplier_rating


def test_supplier_rating_is_derived_from_quality_quantity_and_delivery(tmp_path,monkeypatch):
    path=tmp_path/'supplier-rating.db';shutil.copy2(database.DB_PATH,path);monkeypatch.setattr(database,'DB_PATH',path)
    with database.transaction(immediate=True) as connection:
        user_id=connection.execute("SELECT id FROM users WHERE deleted_at IS NULL ORDER BY id LIMIT 1").fetchone()['id']
        item_id=connection.execute("SELECT id FROM items WHERE deleted_at IS NULL ORDER BY id LIMIT 1").fetchone()['id']
        warehouse_id=connection.execute("SELECT id FROM warehouses WHERE deleted_at IS NULL ORDER BY id LIMIT 1").fetchone()['id']
        supplier_id=connection.execute("INSERT INTO suppliers(supplier_code,name,rating)VALUES('SUP-RATING-TEST','Rating Formula Supplier',5)").lastrowid
        po_id=connection.execute("INSERT INTO purchase_orders(po_number,supplier_id,po_date,status,total_amount,created_by,committed_delivery_date)VALUES('PO-RATING-TEST',?,'2026-01-01','Closed',1000,?,'2026-01-10')",(supplier_id,user_id)).lastrowid
        connection.execute('INSERT INTO po_items(po_id,item_id,quantity,price,tax)VALUES(?,?,100,10,0)',(po_id,item_id))
        grn_id=connection.execute("INSERT INTO grns(grn_number,po_id,supplier_id,grn_date,created_by)VALUES('GRN-RATING-TEST',?,?,'2026-01-09',?)",(po_id,supplier_id,user_id)).lastrowid
        connection.execute('INSERT INTO grn_items(grn_id,item_id,quantity_received,accepted_qty,rejected_qty,unit_cost,warehouse_id)VALUES(?,?,100,80,20,10,?)',(grn_id,item_id,warehouse_id))
        rating=refresh_supplier_rating(connection,supplier_id)
        stored=connection.execute('SELECT rating FROM suppliers WHERE id=?',(supplier_id,)).fetchone()['rating']
    # 45% quality (80/100), 25% quantity (80/100), 30% on-time (1/1), scaled to five.
    assert rating==4.3 and stored==4.3
