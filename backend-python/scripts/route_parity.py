import re,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.main import app
root=Path(__file__).resolve().parents[2]
def canonical(path):
    path=re.sub(r'\{[^}]+\}','{}',path)
    return path[:-1] if path.endswith('/')and path!='/api/' else path
old=set()
for file in (root/'backend'/'src'/'routes').glob('*.ts'):
    base='/api/'+file.name.replace('.routes.ts','')
    text=file.read_text(encoding='utf-8')
    for method,path in re.findall(r"router\.(get|post|put|delete)\(\s*['\"]([^'\"]+)",text):old.add((method.upper(),canonical(re.sub(r':([A-Za-z_]+)',r'{\1}',base+path))))
old.add(('GET','/api/health'))
new={(method,canonical(path.path))for path in app.routes for method in(getattr(path,'methods',set())or set())if path.path.startswith('/api')and method not in{'HEAD','OPTIONS'}}
missing=sorted(old-new);extra=sorted(new-old)
print(f'old={len(old)} new={len(new)} missing={len(missing)} extra={len(extra)}')
for item in missing:print('MISSING',*item)
