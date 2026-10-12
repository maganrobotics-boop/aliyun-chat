def split_report(train, validation, test):
    groups=[train,validation,test]
    for g in groups:
        if not isinstance(g,list) or any(not isinstance(x,str) or not x.strip() for x in g): raise ValueError('invalid trajectory id')
    a,b,c=map(set,groups)
    return {'leaks':sorted((a&b)|(a&c)|(b&c)),'counts':[len(a),len(b),len(c)]}
print('duplicate within train',split_report(['run-1','run-2','run-2'],['run-3'],['run-5','run-4']))
print('leak corrected',split_report(['run-1','run-2'],['run-3'],['run-5','run-4']))