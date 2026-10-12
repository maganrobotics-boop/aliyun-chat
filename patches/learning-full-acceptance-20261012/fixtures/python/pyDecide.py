import math
def decide(state):
    bs=('blocked','clarified','at_goal','holding','delivered','verified')
    ns=('now','seen_at','max_age')
    if not isinstance(state,dict) or any(type(state.get(k)) is not bool for k in bs): raise ValueError('bool fields required')
    if any(isinstance(state.get(k),bool) or not isinstance(state.get(k),(int,float)) or not math.isfinite(state[k]) or state[k]<0 for k in ns): raise ValueError('invalid time')
    if state['now']<state['seen_at'] or (state['delivered'] and state['holding']) or (state['verified'] and not state['delivered']): raise ValueError('inconsistent state')
    if state['blocked']: return 'stop'
    if not state['clarified']: return 'clarify'
    if state['now']-state['seen_at']>state['max_age']: return 'observe'
    if state['delivered']: return 'done' if state['verified'] else 'verify'
    if not state['at_goal']: return 'navigate'
    return 'place' if state['holding'] else 'grasp'
s=dict(blocked=False,clarified=True,now=10,seen_at=10,max_age=5,at_goal=False,holding=False,delivered=False,verified=False)
print('fresh',decide(s))
print('released',decide(dict(s,delivered=True)))
try: decide(dict(s,delivered=True,holding=True))
except ValueError: print('contradiction rejected')