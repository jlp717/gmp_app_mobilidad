"""Validate the plan only. Does not run product, network, database or mutations."""
import argparse
import json
import re
from collections import Counter
from pathlib import Path


def validate(folder, repo):
    errors=[]
    data=json.loads((folder/'backlog.json').read_text(encoding='utf-8'))
    tasks=data['tasks']; by_id={t['id']:t for t in tasks}
    if len(by_id)!=len(tasks): errors.append('duplicate task id')
    needed=('id','phase','priority','title','depends_on','owner','existing_paths','proposed_paths','requirement','steps','acceptance','rollback','approval','effort','status')
    for t in tasks:
        for k in needed:
            if k not in t: errors.append(f"{t.get('id')}: missing {k}")
        if len(t['steps'])<4 or len(t['acceptance'])<3: errors.append(t['id']+': incomplete instructions')
        if t['status'] not in ('TODO','IN_PROGRESS','VERIFIED','BLOCKED'):
            errors.append(t['id']+': invalid execution status')
        if t['status']=='VERIFIED' and not t.get('verification'):
            errors.append(t['id']+': VERIFIED requires recorded verification evidence')
        for d in t['depends_on']:
            if d not in by_id: errors.append(t['id']+': unknown dependency '+d)
        for p in t['existing_paths']:
            if not (repo/p).exists(): errors.append(t['id']+': missing existing path '+p)
        if 'backend/config/db.js' in t['existing_paths'] or 'backend/middleware/auth.js' in t['existing_paths']:
            if 'JAVIER' not in t['approval']: errors.append(t['id']+': protected file without manual gate')
    pending=set(by_id); done=set(); waves=[]
    while pending:
        ready=sorted((i for i in pending if set(by_id[i]['depends_on'])<=done),key=lambda i:(by_id[i]['phase'],by_id[i]['priority'],i))
        if not ready: errors.append('dependency cycle: '+','.join(sorted(pending)));break
        waves.append(ready);done.update(ready);pending.difference_update(ready)
    evidence=json.loads((folder/'evidence.json').read_text(encoding='utf-8'))
    for fact in evidence['facts']:
        if not fact['evidence']: errors.append(fact['id']+': no evidence')
        for e in fact['evidence']:
            if not (repo/e['path']).exists(): errors.append(fact['id']+': evidence path missing '+e['path'])
    # Local Markdown document links only; code file mentions are separately scoped.
    for f in folder.glob('*.md'):
        for link in re.findall(r'\]\(([^)]+)\)',f.read_text(encoding='utf-8')):
            if link.startswith(('https://','http://','#')): continue
            target=link.split('#')[0]
            if target and not (f.parent/target).exists(): errors.append(f.name+': broken link '+target)
    return {'status':'PASS' if not errors else 'BLOCKED','checks_scope':'Plan structure, existing entry paths, dependencies, protected-file manual gates, evidence paths, local Markdown links; not product correctness','task_count':len(tasks),'facts_count':len(evidence['facts']),'priorities':dict(Counter(t['priority'] for t in tasks)),'dependency_waves':waves,'errors':errors}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--repo',type=Path);args=parser.parse_args()
    folder=Path(__file__).resolve().parent
    result=validate(folder,args.repo.resolve() if args.repo else folder.parents[2])
    print(json.dumps(result,ensure_ascii=False,indent=2))
    raise SystemExit(0 if result['status']=='PASS' else 1)
