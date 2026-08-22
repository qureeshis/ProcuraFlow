import json

def log_audit(connection, table_name, record_id, action, user_id=None, before=None, after=None):
    connection.execute('INSERT INTO audit_log(table_name,record_id,action,changed_by,old_values,new_values) VALUES(?,?,?,?,?,?)',
                       (table_name, record_id, action, user_id, json.dumps(before, default=str) if before is not None else None, json.dumps(after, default=str) if after is not None else None))
