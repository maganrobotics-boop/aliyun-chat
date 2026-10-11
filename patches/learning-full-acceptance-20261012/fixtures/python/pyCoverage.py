from collections import deque
def coverage_route(grid,start,dock,visited):
    if not isinstance(grid,list) or not grid or not isinstance(grid[0],list) or not grid[0]: raise ValueError('invalid grid')
    h,w=len(grid),len(grid[0])
    if h>32 or w>32 or h*w>256 or any(not isinstance(row,list) or len(row)!=w or any(type(v) is not int or v not in (0,1) for v in row) for row in grid): raise ValueError('invalid grid')
    def coord(p):
        if not isinstance(p,(list,tuple)) or len(p)!=2 or any(type(v) is not int for v in p): raise ValueError('invalid coordinate')
        x,y=p
        if not 0<=x<w or not 0<=y<h or grid[y][x]!=0: raise ValueError('blocked coordinate')
        return (x,y)
    start,dock=coord(start),coord(dock)
    if not isinstance(visited,list): raise ValueError('invalid visited')
    seen={coord(p) for p in visited}
    def neighbors(p):
        x,y=p
        return [(a,b) for a,b in ((x+1,y),(x,y+1),(x-1,y),(x,y-1)) if 0<=a<w and 0<=b<h and grid[b][a]==0]
    reachable={start};q=deque([start])
    while q:
        for p in neighbors(q.popleft()):
            if p not in reachable: reachable.add(p);q.append(p)
    if dock not in reachable or not seen<=reachable: raise ValueError('disconnected record')
    def path(a,b):
        parent={a:None};q=deque([a])
        while q:
            p=q.popleft()
            if p==b: break
            for n in neighbors(p):
                if n not in parent: parent[n]=p;q.append(n)
        result=[];p=b
        while p is not None: result.append(p);p=parent[p]
        return result[::-1]
    route=[start];seen.add(start)
    targets=sorted(reachable,key=lambda p:(p[1],p[0] if p[1]%2==0 else -p[0]))
    for target in targets:
        if target not in seen:
            extension=path(route[-1],target)[1:];route.extend(extension);seen.update(extension)
    route.extend(path(route[-1],dock)[1:])
    return [list(p) for p in route]
print('resume',coverage_route([[0,0],[0,0]],[1,0],[0,0],[[0,0]]))
try: coverage_route([[0,1,0]],[0,0],[2,0],[])
except ValueError: print('disconnected dock rejected')