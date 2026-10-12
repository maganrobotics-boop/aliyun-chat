import math
def cloud_summary(points,min_range,max_range):
    def finite(x): return not isinstance(x,bool) and isinstance(x,(int,float)) and math.isfinite(x)
    if not finite(min_range) or not finite(max_range) or not 0<=min_range<=max_range: raise ValueError("invalid range")
    kept=[p for p in points if isinstance(p,(list,tuple)) and len(p)==3 and all(finite(x) for x in p) and min_range<=math.hypot(*p)<=max_range]
    return {"count":len(kept),"centroid":[sum(p[i] for p in kept)/len(kept) for i in range(3)] if kept else None}
print("range boundary",cloud_summary([[1,0,0],[0,2,0],[8,0,0]],.5,1))
print("empty",cloud_summary([],0,3))
