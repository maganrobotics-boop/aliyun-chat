# AI助研全课程实测 2026-10-11
import math
def circle(v, omega):
    for name,x in (("v",v),("omega",omega)):
        if isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x): raise ValueError(name+" must be finite")
    if v<0 or omega==0: raise ValueError("v must be non-negative and omega nonzero")
    return {"radius_m":abs(v/omega),"period_s":2*math.pi/abs(omega),"direction":"ccw" if omega>0 else "cw"}
