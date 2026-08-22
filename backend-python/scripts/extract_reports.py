"""One-time migration helper: extract static SQLite report queries from Express routes."""
import json,re
from pathlib import Path
root=Path(__file__).resolve().parents[2]
source=(root/'backend'/'src'/'routes'/'reports.routes.ts').read_text(encoding='utf-8')
pattern=re.compile(r"router\.get\('/([^']+)'[\s\S]*?db\.prepare\(`([\s\S]*?)`\)\.all\(\)",re.M)
queries={}
for path,sql in pattern.findall(source):
    if '${' not in sql and '?' not in sql:queries[path]=sql.strip()
target=root/'backend-python'/'app'/'report_queries.json'
target.write_text(json.dumps(queries,indent=2),encoding='utf-8')
print(f'extracted {len(queries)} static report queries')
