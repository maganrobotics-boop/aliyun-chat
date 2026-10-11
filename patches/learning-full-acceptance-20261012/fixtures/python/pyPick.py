import math
def pick_place_actions(object_pos,goal_pos,clearance):
    def finite(x): return not isinstance(x,bool) and isinstance(x,(int,float)) and math.isfinite(x)
    def pos(p):
        if not isinstance(p,(list,tuple)) or len(p)!=3 or not all(finite(x) for x in p) or not .05<=p[0]<=.5 or not -.3<=p[1]<=.3 or abs(p[2]-.04)>1e-9: raise ValueError("invalid position")
        return list(p)
    a,b=pos(object_pos),pos(goal_pos)
    if not finite(clearance) or not .08<=clearance<=.18 or math.hypot(a[0]-b[0],a[1]-b[1])<.05: raise ValueError("invalid clearance or separation")
    topa=[a[0],a[1],a[2]+clearance];topb=[b[0],b[1],b[2]+clearance]
    def move(p): return {"op":"move","target":p}
    return [move(topa),move(a),{"op":"close","retries":1},move(topa),move(topb),move(b),{"op":"open"},move(topb),{"op":"verify"}]
