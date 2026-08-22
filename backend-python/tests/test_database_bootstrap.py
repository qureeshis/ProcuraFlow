import sqlite3

from app import database


def test_fresh_database_is_created_from_schema_only_bootstrap(tmp_path, monkeypatch):
    target = tmp_path / 'render-data' / 'procuraflow.db'
    monkeypatch.setattr(database, 'DB_PATH', target)

    database.initialize_database()

    assert target.is_file()
    with sqlite3.connect(target) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        assert 'invoices' in tables
        assert connection.execute('SELECT COUNT(*) FROM company').fetchone()[0] == 0
        assert connection.execute('SELECT COUNT(*) FROM users').fetchone()[0] == 0
