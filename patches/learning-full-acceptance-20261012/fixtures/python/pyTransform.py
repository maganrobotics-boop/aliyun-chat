import math
def transform(point, pose):
    def vector(v,n):
        if not isinstance(v,(list,tuple)) or len(v)!=n: raise ValueError("invalid vector length")
        if any(isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x) for x in v): raise ValueError("finite numbers required")
    vector(point,2); vector(pose,3)
    x,y=point;tx,ty,a=pose
    return [tx+math.cos(a)*x-math.sin(a)*y,ty+math.sin(a)*x+math.cos(a)*y]
