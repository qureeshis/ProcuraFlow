const Database=require('better-sqlite3');
const db=new Database('procuraflow.db',{readonly:true});
const one=(sql)=>db.prepare(sql).get();
const table=(name)=>one(`SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?`.replace('?',`'${name}'`));
const value=(sql)=>Number(one(sql)?.n||0);
const status={
 integrity:one('PRAGMA integrity_check').integrity_check,
 foreign_keys:db.prepare('PRAGMA foreign_key_check').all().length,
 ledger_total:value('SELECT COUNT(*) n FROM legacy_ledger_reconciliation'),
 ledger_reviewed:value("SELECT COUNT(*) n FROM legacy_ledger_reconciliation WHERE reviewed_by IS NOT NULL"),
 sod_total:table('sod_conflict_reviews')?value('SELECT COUNT(*) n FROM sod_conflict_reviews'):0,
 sod_unexplained_high:table('sod_conflict_reviews')?value("SELECT COUNT(*) n FROM sod_conflict_reviews WHERE risk='HIGH' AND (management_decision IS NULL OR trim(management_decision)='')"):0,
 finance_active_operational_roles:value("SELECT COUNT(*) n FROM users WHERE lower(role)='finance' AND is_active=1 AND deleted_at IS NULL"),
 finance_users_with_access:value("SELECT COUNT(*) n FROM users u JOIN employees e ON e.id=u.employee_id JOIN departments dp ON dp.id=e.department_id WHERE lower(dp.name)='finance' AND u.is_active=1 AND u.deleted_at IS NULL"),
 delegations:value('SELECT COUNT(*) n FROM delegated_authorities'),
 external_handoffs:value('SELECT COUNT(*) n FROM external_finance_handoffs')
};
console.log(JSON.stringify(status,null,2));db.close();
