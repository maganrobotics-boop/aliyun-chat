# AI助研全课程实测 2026-10-11
import math

def checked(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ValueError("expected a non-negative finite number")
    return value

def travel_distance(speed, seconds):
    return checked(speed) * checked(seconds)

def from_mm(speed_mm_s, seconds):
    return travel_distance(checked(speed_mm_s) / 1000.0, seconds)

for speed, seconds in [(0.5,4),(0.5,6),(0.5,0)]:
    print(speed, seconds, travel_distance(speed,seconds))
print("500 mm/s for 4 s:", from_mm(500,4))
for bad in [-1, float("nan"), float("inf")]:
    try:
        travel_distance(bad, 4)
    except ValueError:
        print("invalid input rejected:", bad)
