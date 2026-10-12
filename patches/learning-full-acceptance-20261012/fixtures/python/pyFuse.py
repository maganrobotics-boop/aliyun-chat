import math
def fuse(x1,var1,x2,var2):
    if any(isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x) for x in (x1,var1,x2,var2)) or var1<=0 or var2<=0: raise ValueError("finite estimates and positive variances required")
    d=var1+var2
    return {"estimate":(x1*var2+x2*var1)/d,"variance":var1*var2/d}
print("equal variances",fuse(0,4,10,4))
