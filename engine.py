"""Idealized Celeris cases. Standard-library Python; shared by browser and CLI."""
import json, math, io, zipfile

G = 9.81
MAX_CELLS = 1048576

def finite(value, name, low=None, high=None):
    if isinstance(value, bool):
        raise ValueError(f'{name}: A number is required.')
    v = float(value)
    if not math.isfinite(v) or (low is not None and v < low) or (high is not None and v > high):
        raise ValueError(f'{name}: Check the allowed range.')
    return v

def wave_length(period, depth):
    omega = 2 * math.pi / period
    lo, hi = 0.0, max(omega**2/G, omega/math.sqrt(G*depth)) * 2
    while G*hi*math.tanh(hi*depth) < omega**2:
        hi *= 2
    for _ in range(80):
        k = (lo+hi)/2
        if G*k*math.tanh(k*depth) < omega**2: lo = k
        else: hi = k
    return 2*math.pi/((lo+hi)/2)

def build(s):
    nxf, nyf = finite(s['nx'], 'nx', 16, 2048), finite(s['ny'], 'ny', 16, 2048)
    if not nxf.is_integer() or not nyf.is_integer(): raise ValueError('nx and ny must be integers.')
    nx, ny = int(nxf), int(nyf)
    if nx*ny > MAX_CELLS: raise ValueError('The browser version supports up to 1,048,576 cells.')
    lx, ly = finite(s['lx'], 'Lx', .01, 1e7), finite(s['ly'], 'Ly', .01, 1e7)
    dx, dy = lx/nx, ly/ny
    depth = finite(s['depth'], 'Reference depth', .001, 1e5)
    slope = finite(s['slope'], 'Slope', -10, 10)
    pos = finite(s['position'], 'Start position', 0, 1)
    height = finite(s['height'], 'Terrain height', -1e5, 1e5)
    width = finite(s['width'], 'Terrain width', .001, 1e7)
    cx, cy = finite(s['cx'], 'Center x', 0, 1)*lx, finite(s['cy'], 'Center y', 0, 1)*ly
    angle = math.radians(finite(s['terrainAngle'], 'Terrain orientation', -360, 360))
    ca, sa = math.cos(angle), math.sin(angle)
    kind = s['terrain']
    if kind not in ['flat','slope','step','terrace','bar','channel','island']: raise ValueError('Unsupported terrain type.')
    # Projection origin is the smallest projected domain corner; slope starts at a fraction of span.
    corners = [0, lx*ca, ly*sa, lx*ca+ly*sa]
    qmin, qmax = min(corners), max(corners)
    start = qmin + pos*(qmax-qmin)
    bs = []
    errors, warnings = [], []
    if len(s['breakwaters']) > 30: raise ValueError('A maximum of 30 breakwaters is supported.')
    for b in s['breakwaters']:
        if not b['enabled']: continue
        ix, iy = finite(b['i'], 'Breakwater i', 0, nx-1), finite(b['j'], 'Breakwater j', 0, ny-1)
        if not ix.is_integer() or not iy.is_integer(): raise ValueError('Breakwater indices must be integers.')
        length, thick = finite(b['length'], 'Breakwater length', .001, 1e7), finite(b['thickness'], 'Breakwater thickness', .001, 1e7)
        a = math.radians(finite(b['angle'], 'Breakwater angle', -360, 360))
        crest = finite(b['crest'], 'Crest elevation', -1e5, 1e5)
        x, y = (ix+.5)*dx, (iy+.5)*dy
        c, sn = math.cos(a), math.sin(a)
        ex, ey = abs(c)*length/2+abs(sn)*thick/2, abs(sn)*length/2+abs(c)*thick/2
        if x-ex < 0 or x+ex > lx or y-ey < 0 or y+ey > ly: errors.append('A breakwater extends outside the domain.')
        if thick < 2*max(dx,dy): warnings.append('A breakwater is thinner than two cells. Terrain cleanup may alter its shape.')
        bs.append((x,y,c,sn,length,thick,crest))
    z, hits = [], [0]*len(bs)
    bmin = {k:float('inf') for k in ['west','east','south','north']}
    bsum = dict.fromkeys(bmin,0.0); bcount = dict.fromkeys(bmin,0); bmax = dict.fromkeys(bmin,0.0); blocked = dict.fromkeys(bmin,False)
    wet_sum, wet_count = 0.0, 0
    for j in range(ny):
        y=(j+.5)*dy
        for i in range(nx):
            x=(i+.5)*dx; q=x*ca+y*sa
            v=-depth
            if kind=='slope': v+=max(0,q-start)*slope
            elif kind=='step': v+=height if q>=start else 0
            elif kind=='terrace': v+=height*min(3,max(0,math.floor((q-start)/width)+1))
            elif kind in ['bar','channel']:
                r=((x-cx)*ca+(y-cy)*sa)/width
                v+=(height if kind=='bar' else -abs(height))*math.exp(-.5*r*r)
            elif kind=='island':
                r=math.hypot(x-cx,y-cy)/width
                v+=height*max(0,1-r)
            structure=False
            for bi,(bx,by,c,sn,l,t,crest) in enumerate(bs):
                xx,yy=x-bx,y-by
                if abs(xx*c+yy*sn)<=l/2 and abs(-xx*sn+yy*c)<=t/2:
                    hits[bi]+=1; structure=True; v=max(v,crest)
            z.append(v)
            h=max(0,-v)
            if h>1e-4: wet_sum+=h; wet_count+=1
            sides=[]
            if i<5:sides.append('west')
            if i>=nx-5:sides.append('east')
            if j<5:sides.append('south')
            if j>=ny-5:sides.append('north')
            for side in sides:
                bmin[side]=min(bmin[side],h); bmax[side]=max(bmax[side],h)
                bsum[side]+=h; bcount[side]+=1; blocked[side] |= structure
    if any(v==0 for v in hits): errors.append('A breakwater does not intersect any grid cells. Change its thickness or position.')
    side=s['boundary']
    if side not in bmin: raise ValueError('Select a wave generation boundary.')
    hgen=bsum[side]/bcount[side]
    if bmin[side]<=1e-4: errors.append('The outer five cells at the generation boundary contain dry areas, including the terrain-flattening zone.')
    if blocked[side]: errors.append('A breakwater overlaps the outer five cells at the generation boundary, including the terrain-flattening zone.')
    theta=math.radians(finite(s['direction'],'Propagation angle',-360,360))
    inward={'west':math.cos(theta),'east':-math.cos(theta),'south':math.sin(theta),'north':-math.sin(theta)}[side]
    if inward<=1e-6: errors.append('Waves must propagate into the domain from the selected boundary.')
    H=finite(s['waveHeight'],'Wave height',.00001,1e5)
    phase=finite(s['phase'],'Phase',-360,360)
    if s['waveMode'] not in ['period','length']: raise ValueError('Check the wave input mode.')
    inp=finite(s['waveInput'],'Period/wavelength',.001,1e7)
    T=inp if s['waveMode']=='period' else (2*math.pi/math.sqrt(G*(2*math.pi/inp)*math.tanh((2*math.pi/inp)*max(hgen,1e-4))))
    L=wave_length(T,max(hgen,1e-4)) if s['waveMode']=='period' else inp
    mean=wet_sum/wet_count if wet_count else 0
    if not wet_count: errors.append('The domain has no wet cells.')
    if H/2>=bmin[side]: errors.append('The wave trough reaches the bed in the generation zone. Reduce wave height or increase depth.')
    if bmax[side]-bmin[side] > .05*max(hgen,1e-4): warnings.append('Depth variation in the generation zone exceeds 5%. Waves use a single base_depth.')
    resolution=L/max(dx,dy)
    if resolution<20: warnings.append('There are fewer than 20 cells per wavelength. Check grid convergence.')
    if int(s['solver']) not in [0,1]: raise ValueError('Check the selected model.')
    if abs(math.sin(theta)*math.cos(theta))>.001: warnings.append('Oblique incidence from a single boundary may produce adjacent-boundary and corner effects.')
    finite(s['courant'],'Courant number',.001,.5); finite(s['friction'],'Manning n',0,1)
    if s['otherBoundary'] not in ['sponge','wall']: raise ValueError('Check the boundary conditions.')
    k_approx=(2*math.pi/T)**2/(G*math.sqrt(math.tanh((2*math.pi/T)**2*max(hgen,1e-4)/G)))
    return dict(z=z,nx=nx,ny=ny,dx=dx,dy=dy,zmin=min(z),zmax=max(z),meanDepth=mean,generationDepth=hgen,T=T,L=L,solverL=2*math.pi/k_approx,H=H,theta=theta,phase=math.radians(phase),relative=mean/L,resolution=resolution,errors=list(dict.fromkeys(errors)),warnings=list(dict.fromkeys(warnings)),boundaries={k:dict(minDepth=bmin[k],blocked=blocked[k],meanDepth=bsum[k]/bcount[k]) for k in bmin},wetFraction=wet_count/(nx*ny))

def export_zip(s, progress=lambda msg: None):
    progress('Validating input conditions…')
    r=build(s)
    if r['errors']: raise ValueError(' / '.join(r['errors']))
    progress('Writing bathy.txt…')
    nx,ny=r['nx'],r['ny']
    bath='\n'.join(' '.join(f'{v:.9g}' for v in r['z'][j*nx:(j+1)*nx]) for j in range(ny))+'\n'
    progress('Writing waves.txt…')
    waves=f"[NumberOfWaves] 1\n=================================\n{r['H']/2:.12g} {r['T']:.12g} {r['theta']:.12g} {r['phase']:.12g}\n"
    progress('Writing config.json…')
    config=dict(WIDTH=nx,HEIGHT=ny,dx=r['dx'],dy=r['dy'],grid_type=1,seaLevel=0,base_depth=r['generationDepth'],g=G,Courant_num=float(s['courant']),NLSW_or_Bous=int(s['solver']),Theta=1.5,isManning=1,friction=float(s['friction']),timeScheme=2,Bcoef=1/15,tridiag_solve=2,incident_wave_type=-1,numberOfWaves=1,BoundaryWidth=min(20,max(3,min(nx,ny)//8)),GoogleMapOverlay=0,significant_wave_height=r['H']/math.sqrt(2),dissipation_threshold=.3,whiteWaterDecayRate=.9)
    for side in ['west','east','south','north']:config[side+'_boundary_type']=2 if side==s['boundary'] else (1 if s['otherBoundary']=='sponge' else 0)
    settings=dict(s); settings['schemaVersion']=1
    report={k:v for k,v in r.items() if k!='z'}
    report['notes']=['Rows run south to north; columns west to east. Elevation positive upward; still water is zero.', 'Cell outer bounds define Lx, Ly. dx=Lx/nx. Celeris sample coordinates use i*dx: a half-cell origin shift does not affect ideal geometry.', 'L is exact linear dispersion at generationDepth. solverL uses the inspected upstream approximate boundary dispersion.', 'Regular wave H is crest-to-trough; waves amplitude is H/2. significant_wave_height is H/sqrt(2).', 'Not an executed hydrodynamic simulation. Celeris may alter boundary bathymetry or isolated cells on loading.']
    progress('Compressing ZIP…')
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as zipf:
        zipf.writestr('bathy.txt',bath);zipf.writestr('waves.txt',waves)
        for name,obj in [('config.json',config),('case_settings.json',settings),('validation_report.json',report)]:zipf.writestr(name,json.dumps(obj,ensure_ascii=False,indent=2,allow_nan=False))
    return out.getvalue()

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('settings');p.add_argument('-o','--output',default='celeris_case.zip');a=p.parse_args()
    with open(a.settings,encoding='utf-8') as f:s=json.load(f)
    data=export_zip(s,print)
    with open(a.output,'wb') as f:f.write(data)
    print(a.output)
