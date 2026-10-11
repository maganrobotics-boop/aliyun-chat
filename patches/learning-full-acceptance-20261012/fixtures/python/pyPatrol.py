def patrol_report(required, records):
    validstr=lambda x:isinstance(x,str) and bool(x.strip())
    if not isinstance(required,list) or not required or not all(validstr(x) for x in required) or len(set(required))!=len(required) or not isinstance(records,list):
        raise ValueError('invalid task')
    done=set()
    for r in records:
        if not isinstance(r,dict) or not validstr(r.get('point')) or not all(type(r.get(k)) is bool for k in ('arrived','observed','verified')):
            raise ValueError('invalid record')
        if all(r[k] for k in ('arrived','observed','verified')): done.add(r['point'])
    completed=[p for p in required if p in done]
    missing=[p for p in required if p not in done]
    return {'completed':completed,'missing':missing,'success':not missing}
print('complete variant',patrol_report(['A','B'],[{'point':p,'arrived':True,'observed':True,'verified':True} for p in ['A','B']]))