#!/usr/bin/env python3
"""Minimal persistent UCI test double for firewall ownership scenarios."""
import json, os, re, sys
from pathlib import Path
p=Path(os.environ['UCI_FIXTURE']); state=json.loads(p.read_text()); args=sys.argv[1:]
if args and args[0]=='-q': args=args[1:]
cmd=args.pop(0)
failure=os.environ.get('UCI_FAIL_ONCE')
marker=p.with_suffix('.failed')
if failure and cmd+' '+(' '.join(args)) == failure and not marker.exists():
 marker.touch();sys.exit(7)
def section(key):
 m=re.fullmatch(r'firewall\.@(\w+)\[(\d+)\](?:\.(\w+))?',key)
 if m:
  matches=[s for s in state['sections'] if s['type']==m[1]]
  i=int(m[2]);return (matches[i] if i<len(matches) else None),m[3]
 m=re.fullmatch(r'firewall\.([^.]+)(?:\.(\w+))?',key)
 if m: return next((s for s in state['sections'] if s['id']==m[1]),None),m[2]
 return None,None
if cmd=='get':
 s,field=section(args[0])
 if not s or (field and field not in s['options']):sys.exit(1)
 value=s['options'][field] if field else s['type']
 print(' '.join(value) if isinstance(value,list) else value)
elif cmd=='add':
 sid='generated'+str(state.get('counter',0));state['counter']=state.get('counter',0)+1
 state['sections'].append({'id':sid,'type':args[1],'options':{}});print(sid)
elif cmd in ['set','add_list']:
 key,value=args[0].split('=',1);s,field=section(key)
 if s is None or field is None:sys.exit(1)
 if cmd=='set':s['options'][field]=value
 else:s['options'].setdefault(field,[]).append(value)
elif cmd=='delete':
 s,field=section(args[0])
 if not s:sys.exit(1)
 if field:s['options'].pop(field,None)
 else:state['sections'].remove(s)
elif cmd=='export': print(json.dumps(state))
elif cmd=='import': state['sections']=json.loads(sys.stdin.read())['sections']
elif cmd=='commit': state['commits']=state.get('commits',0)+1
else: raise RuntimeError(cmd)
p.write_text(json.dumps(state))
