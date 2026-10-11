import math
def conflicts(tasks):
    if not isinstance(tasks,list): raise ValueError('tasks must be list')
    ids=set()
    for t in tasks:
        if not isinstance(t,dict) or not isinstance(t.get('id'),str) or not t['id'].strip() or t['id'] in ids or t.get('arm') not in ('left','right') or type(t.get('shared')) is not bool: raise ValueError('invalid task')
        if any(isinstance(t.get(k),bool) or not isinstance(t.get(k),(int,float)) or not math.isfinite(t[k]) for k in ('start','end')) or not 0<=t['start']<t['end']: raise ValueError('invalid interval')
        ids.add(t['id'])
    return [[a['id'],b['id']] for i,a in enumerate(tasks) for b in tasks[i+1:] if max(a['start'],b['start'])<min(a['end'],b['end']) and (a['arm']==b['arm'] or (a['shared'] and b['shared']))]
a=dict(id='L1',arm='left',start=0,end=2,shared=True)
b=dict(id='R1',arm='right',start=1,end=3,shared=True)
print('one shared',conflicts([a,dict(b,shared=False)]))
print('touching endpoints',conflicts([a,dict(b,start=2)]))