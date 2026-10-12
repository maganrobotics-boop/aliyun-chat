import math
def velocity(error,kp,max_speed,tolerance):
    vals=(error,kp,max_speed,tolerance)
    if any(isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x) for x in vals) or kp<=0 or max_speed<=0 or tolerance<0: raise ValueError("invalid control parameters")
    return 0.0 if abs(error)<=tolerance else max(-max_speed,min(max_speed,kp*error))
print("negative error",velocity(-2,.5,.4,.05))
print("tolerance boundary",velocity(.05,.5,.4,.05))
