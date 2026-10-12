import math
def verify_delivery(target,destination,observation):
    validstr=lambda x:isinstance(x,str) and bool(x.strip())
    if not validstr(target) or not validstr(destination) or not isinstance(observation,dict): raise ValueError('invalid identifiers')
    o=observation
    if any(not validstr(o.get(k)) for k in ('object','location')) or any(type(o.get(k)) is not bool for k in ('released','seen')): raise ValueError('invalid observation')
    if any(isinstance(o.get(k),bool) or not isinstance(o.get(k),(int,float)) or not math.isfinite(o[k]) or o[k]<0 for k in ('age','max_age')): raise ValueError('invalid age')
    reason='verified'
    if not o['seen']: reason='unseen'
    elif o['age']>o['max_age']: reason='stale'
    elif o['object']!=target: reason='wrong_object'
    elif o['location']!=destination: reason='wrong_location'
    elif not o['released']: reason='still_holding'
    return {'success':reason=='verified','reason':reason}
o=dict(object='box-1',location='table-B',released=False,seen=True,age=1,max_age=3)
print('not released',verify_delivery('box-1','table-B',o))