# AI助研全课程实测 2026-10-11
from collections import deque
def plan(grid,start,goal):
    if not isinstance(grid,(list,tuple)) or not grid or not isinstance(grid[0],(list,tuple)) or not grid[0]: raise ValueError("empty grid")
    h,w=len(grid),len(grid[0])
    for row in grid:
        if not isinstance(row,(list,tuple)) or len(row)!=w or any(type(v) is not int or v not in (0,1) for v in row): raise ValueError("invalid grid")
    def point(p):
        if not isinstance(p,(list,tuple)) or len(p)!=2 or any(type(x) is not int for x in p): raise ValueError("invalid coordinate")
        r,c=p
        if not 0<=r<h or not 0<=c<w or grid[r][c]!=0: raise ValueError("blocked or out of bounds")
        return (r,c)
    s,g=point(start),point(goal); parents={s:None}; q=deque([s])
    while q:
        p=q.popleft()
        if p==g:
            path=[]
            while p is not None: path.append(list(p)); p=parents[p]
            return path[::-1]
        for dr,dc in ((1,0),(-1,0),(0,1),(0,-1)):
            n=(p[0]+dr,p[1]+dc)
            if 0<=n[0]<h and 0<=n[1]<w and grid[n[0]][n[1]]==0 and n not in parents: parents[n]=p; q.append(n)
    return None
