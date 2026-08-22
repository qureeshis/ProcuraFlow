import shutil
import sqlite3

from app import database
from app.routes.masters import create_warehouse_shifts
from app.routes.workforce import generate_calendar_range


def test_warehouse_role_with_more_than_two_available_employees_rotates_weekly(tmp_path, monkeypatch):
    test_database = tmp_path / 'seven-day-rotation.db'
    shutil.copy2(database.DB_PATH, test_database)
    monkeypatch.setattr(database, 'DB_PATH', test_database)

    with sqlite3.connect(test_database) as connection:
        scm_id = connection.execute("SELECT id FROM users WHERE role='SupplyChainManager' AND is_active=1 AND deleted_at IS NULL LIMIT 1").fetchone()[0]
        department_id = connection.execute("SELECT id FROM departments WHERE lower(name)='warehouse' AND deleted_at IS NULL LIMIT 1").fetchone()[0]
        warehouse_id = connection.execute("INSERT INTO warehouses(warehouse_code,name) VALUES('ROT-TEST','Rotation Test Warehouse')").lastrowid
        connection.row_factory = sqlite3.Row
        create_warehouse_shifts(connection, warehouse_id, '03:00', 1440)
        employee_ids = []
        for index in range(4):
            employee_ids.append(connection.execute(
                """INSERT INTO employees(employee_code,name,first_name,last_name,department_id,warehouse_id,
                   approval_role,position,status,system_access_yn) VALUES(?,?,?,?,?,?,'Helper','Helper','Active',0)""",
                (f'ROT-H-{index+1}', f'Rotation Helper {index+1}', 'Rotation', f'Helper {index+1}', department_id, warehouse_id),
            ).lastrowid)

    result = generate_calendar_range('2030-01-07', '2030-01-20', scm_id, trigger='ROTATION_TEST')
    assert result['created'] >= 56

    with sqlite3.connect(test_database) as connection:
        placeholders = ','.join('?' for _ in employee_ids)
        rows = connection.execute(
            f"""SELECT employee_id,calendar_date,shift_id,remarks FROM employee_work_calendar
                WHERE employee_id IN({placeholders}) AND calendar_date BETWEEN '2030-01-07' AND '2030-01-20'
                ORDER BY employee_id,calendar_date""", employee_ids,
        ).fetchall()
    assert len(rows) == 56
    by_employee = {employee_id: [] for employee_id in employee_ids}
    for row in rows:
        by_employee[row[0]].append(row)
    for employee_rows in by_employee.values():
        first_week = {row[2] for row in employee_rows[:7]}
        second_week = {row[2] for row in employee_rows[7:]}
        assert len(first_week) == 1
        assert len(second_week) == 1
        assert first_week != second_week
        assert all(row[3] == 'Automatic seven-day role rotation' for row in employee_rows)
    assert len({employee_rows[0][2] for employee_rows in by_employee.values()}) == 4


def test_rotation_requires_more_than_two_available_people_in_same_role(tmp_path, monkeypatch):
    test_database = tmp_path / 'rotation-threshold.db'
    shutil.copy2(database.DB_PATH, test_database)
    monkeypatch.setattr(database, 'DB_PATH', test_database)
    with sqlite3.connect(test_database) as connection:
        scm_id = connection.execute("SELECT id FROM users WHERE role='SupplyChainManager' AND is_active=1 AND deleted_at IS NULL LIMIT 1").fetchone()[0]
        department_id = connection.execute("SELECT id FROM departments WHERE lower(name)='warehouse' AND deleted_at IS NULL LIMIT 1").fetchone()[0]
        warehouse_id = connection.execute("INSERT INTO warehouses(warehouse_code,name) VALUES('ROT-TWO','Two Available Warehouse')").lastrowid
        connection.row_factory = sqlite3.Row
        create_warehouse_shifts(connection, warehouse_id, '03:00', 1440)
        ids = [connection.execute(
            "INSERT INTO employees(employee_code,name,department_id,warehouse_id,approval_role,status,system_access_yn) VALUES(?,?,?,?,?,'Active',0)",
            (f'ROT-T-{index}', f'Threshold Helper {index}', department_id, warehouse_id, 'Helper'),
        ).lastrowid for index in range(2)]
    generate_calendar_range('2030-02-04', '2030-02-10', scm_id, trigger='THRESHOLD_TEST')
    with sqlite3.connect(test_database) as connection:
        rows = connection.execute(
            "SELECT DISTINCT shift_id,remarks FROM employee_work_calendar WHERE employee_id IN(?,?) AND calendar_date BETWEEN '2030-02-04' AND '2030-02-10'",
            ids,
        ).fetchall()
    assert len(rows) == 1
    assert rows[0][1] is None
