# AI助研全课程实测 2026-10-11
import math

def summarize(rows, threshold=1.5):
    def finite(v, label):
        if isinstance(v, bool) or not isinstance(v, (int,float)) or not math.isfinite(v):
            raise ValueError(label + " must be finite")
        return v
    finite(threshold,"threshold")
    if threshold <= 0: raise ValueError("threshold must be positive")
    if not isinstance(rows, (list,tuple)) or len(rows)<2: raise ValueError("at least two rows required")
    for i,r in enumerate(rows):
        for k in ("t_s","x_m","y_m","battery_pct"):
            if k not in r: raise ValueError("row %s missing %s" % (i,k))
            finite(r[k], "row %s %s" % (i,k))
        if not 0<=r["battery_pct"]<=100: raise ValueError("row %s battery_pct" % i)
        if i and r["t_s"]<=rows[i-1]["t_s"]: raise ValueError("row %s t_s must increase" % i)
    distance=0.0; maximum=0.0; suspicious=[]
    for a,b in zip(rows,rows[1:]):
        ds=math.hypot(b["x_m"]-a["x_m"],b["y_m"]-a["y_m"]); dt=b["t_s"]-a["t_s"]; speed=ds/dt
        distance+=ds; maximum=max(maximum,speed)
        if speed>threshold: suspicious.append({"start_s":a["t_s"],"end_s":b["t_s"],"speed_mps":speed})
    duration=rows[-1]["t_s"]-rows[0]["t_s"]
    return {"samples":len(rows),"duration_s":duration,"distance_m":distance,"mean_speed_mps":distance/duration,"max_speed_mps":maximum,"displacement_m":math.hypot(rows[-1]["x_m"]-rows[0]["x_m"],rows[-1]["y_m"]-rows[0]["y_m"]),"battery_drop_pp":rows[0]["battery_pct"]-rows[-1]["battery_pct"],"suspicious":suspicious}
