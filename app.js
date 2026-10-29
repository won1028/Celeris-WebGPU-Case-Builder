'use strict';
const $=id=>document.getElementById(id);
const defaults={schemaVersion:1,nx:160,ny:100,lx:320,ly:200,terrain:'slope',depth:10,slope:.04,position:.45,height:5,width:30,cx:.6,cy:.5,terrainAngle:0,breakwaters:[],boundary:'west',direction:0,waveMode:'period',waveInput:8,waveHeight:1,phase:0,solver:1,courant:.15,friction:.02,otherBoundary:'sponge'};
let s=structuredClone(defaults),result=null,revision=0,previewId=0,busy=false,pending=false,queued=null,timer,playing=true,phaseTime=0,lastTime=0;
const worker=new Worker('worker.js');
let zoom=1,panX=0,panY=0,selectedJ=50,drag=null,transform;
const raster=document.createElement('canvas');
const coast=document.createElement('canvas');
function field(parent,key,label,opts={}){
 const wrap=document.createElement('label');wrap.className='field'+(opts.full?' full':'');
 const title=document.createElement('span');title.textContent=label;wrap.append(title);
 let input=document.createElement(opts.options?'select':'input');input.id=key;
 if(opts.options){for(const [value,text] of opts.options){const o=document.createElement('option');o.value=value;o.textContent=text;input.append(o);}}
 else {input.type='text';input.inputMode=opts.step===1?'numeric':'decimal';input.autocomplete='off';input.spellcheck=false;}
 input.value=s[key];const update=()=>{if(key==='waveMode'&&result&&!result.errors.length)s.waveInput=input.value==='period'?result.T:result.L;s[key]=opts.options?input.value:(input.value.trim()===''?null:Number(input.value));if(['nx','ny'].includes(key))selectedJ=Math.floor(s.ny/2);changed(!!opts.options);}; if(opts.options) input.onchange=update; else input.oninput=update;
 wrap.append(input);$(parent).append(wrap);
}
function controls(){
 for(const id of ['gridFields','terrainFields','waveFields','configFields'])$(id).replaceChildren();
 field('gridFields','nx','nx · Cells along x',{step:1,min:16,max:2048});field('gridFields','ny','ny · Cells along y',{step:1,min:16,max:2048});
 field('gridFields','lx','Domain Lx (m)',{min:.01});field('gridFields','ly','Domain Ly (m)',{min:.01});
 field('terrainFields','terrain','Terrain type',{full:true,options:[['flat','Flat bed'],['slope','Uniform slope'],['step','Single step'],['terrace','Three-step terrace'],['bar','Gaussian bar'],['channel','Gaussian channel'],['island','Conical island']]});
 field('terrainFields','depth','Reference depth (m)',{min:.001});field('terrainFields','terrainAngle','Rise / width axis (°)');
 field('terrainFields','slope','Slope Δz / Δx');field('terrainFields','position','Start position (0–1)',{min:0,max:1});
 field('terrainFields','height','Height / step rise (m)');field('terrainFields','width','Width σ / step / radius (m)',{min:.001});
 field('terrainFields','cx','Center x / Lx (0–1)',{min:0,max:1});field('terrainFields','cy','Center y / Ly (0–1)',{min:0,max:1});
 field('waveFields','boundary','Incident boundary',{full:true,options:[['west','West · x = 0'],['east','East · x = Lx'],['south','South · y = 0'],['north','North · y = Ly']]});
 field('waveFields','direction','Propagation angle (°)');field('waveFields','waveHeight','Wave height H (m)',{min:.00001});
 field('waveFields','waveMode','Wave input',{full:true,options:[['period','Period T → calculate wavelength'],['length','Wavelength L → calculate period']]});
 field('waveFields','waveInput',s.waveMode==='period'?'Period T (s)':'Wavelength L (m)',{min:.001});field('waveFields','phase','Initial phase (°)');
 field('configFields','solver','Governing equations',{full:true,options:[['1','Boussinesq'],['0','NLSW · Long waves']]});
 field('configFields','courant','Courant number',{min:.001,max:.5});field('configFields','friction','Manning n',{min:0,max:1});
 field('configFields','otherBoundary','Other boundaries',{full:true,options:[['sponge','Absorbing sponge'],['wall','Reflecting wall']]});
 // Dependent fields are disabled instead of leaving inactive parameters ambiguous.
 const active={flat:['depth'],slope:['depth','terrainAngle','slope','position'],step:['depth','terrainAngle','height','position'],terrace:['depth','terrainAngle','height','position','width'],bar:['depth','terrainAngle','height','width','cx','cy'],channel:['depth','terrainAngle','height','width','cx','cy'],island:['depth','height','width','cx','cy']}[s.terrain]||[];
 for(const key of ['depth','terrainAngle','slope','position','height','width','cx','cy'])$(key).disabled=!active.includes(key);
 $('terrainHelp').textContent={flat:'Bed elevation z = −reference depth.',slope:'Rises along the selected axis after the start position. Slope 0.05 = 1:20.',step:'Bed elevation changes by the step rise at the start position.',terrace:'Creates three steps, spaced by the step width, after the start position.',bar:'Adds the specified height at the centerline. Width is the Gaussian standard deviation σ.',channel:'Deepens the centerline by the absolute terrain height. Width is the standard deviation σ.',island:'Height peaks at the center. Beyond the radius, the bed returns to the reference depth.'}[s.terrain];
 renderBreakwaters();
}
function renderBreakwaters(){
 $('breakwaters').replaceChildren();
 if(!s.breakwaters.length){const p=document.createElement('p');p.className='help';p.textContent='No breakwaters. Select ＋ Add to place a structure.';$('breakwaters').append(p);}
 s.breakwaters.forEach((b,index)=>{
  const box=document.createElement('div');box.className='bw';
  const head=document.createElement('div');head.className='bwHead';const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=b.enabled;check.onchange=()=>{b.enabled=check.checked;changed();};label.append(check,` Breakwater ${index+1} · ${b.crest<0?'Submerged':'Emergent'}`);
  const remove=document.createElement('button');remove.textContent='Remove';remove.onclick=()=>{s.breakwaters.splice(index,1);changed();};head.append(label,remove);box.append(head);
  const fields=document.createElement('div');fields.className='fields';
  for(const [key,text] of [['i','Center i (0-based)'],['j','Center j (0-based)'],['length','Length (m)'],['thickness','Thickness (m)'],['angle','Orientation (°)'],['crest','Crest elevation (m)']]){
   const l=document.createElement('label');l.className='field';const span=document.createElement('span');span.textContent=text;const inp=document.createElement('input');inp.type='text';inp.inputMode=['i','j'].includes(key)?'numeric':'decimal';inp.autocomplete='off';inp.spellcheck=false;inp.value=b[key];inp.disabled=!b.enabled;inp.oninput=()=>{b[key]=inp.value.trim()===''?null:Number(inp.value);changed(false);};l.append(span,inp);fields.append(l);
  }box.append(fields);$('breakwaters').append(box);
 });
}
function changed(rebuild=true){revision++;$('save').disabled=true;$('log').textContent='Settings changed · Waiting to calculate…';if(rebuild)controls();clearTimeout(timer);timer=setTimeout(requestPreview,200);}
function requestPreview(){
 const req={type:'preview',id:revision,settings:structuredClone(s)};
 if(pending||busy){queued=req;return;}
 pending=true;previewId=req.id;$('log').textContent='Calculating bathymetry and wave conditions…';worker.postMessage(req);
}
function next(){if(queued&&!busy){const req=queued;queued=null;pending=true;previewId=req.id;worker.postMessage(req);}}
worker.onmessage=({data})=>{
 if(data.type==='log'){$('log').textContent=data.message;return;}
 if(data.type==='preview'){
  pending=false;if(data.id===revision){result=data.result;makeRaster();updateDiagnostics();$('log').textContent=result.errors.length?'Please correct the input conditions.':'Input validation complete';$('save').disabled=!!result.errors.length;}
  next();
 }else if(data.type==='error'){
  pending=false;busy=false;document.querySelectorAll('aside input,aside select,#breakwaters button,#add,#load').forEach(x=>x.disabled=false);controls();$('save').disabled=true;$('log').textContent='Execution failed';checks([data.message],[]);next();
 }else if(data.type==='export'){
  const blob=new Blob([data.bytes],{type:'application/zip'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='celeris_case.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  busy=false;controls();$('add').disabled=false;$('load').disabled=false;$('save').disabled=false;$('log').textContent='ZIP created · Download started.';next();
 }
};
worker.onerror=e=>{$('log').textContent='Python initialization failed';checks(['Could not load Python. Check your internet connection and CDN access, then refresh. '+e.message],[]);};
function checks(errors,warnings){$('checks').replaceChildren();for(const [kind,messages] of [['error',errors],['warn',warnings],['good',errors.length?[]:['Wave boundary and export checks passed.']]])for(const message of messages){const e=document.createElement('div');e.className='check '+kind;e.textContent=(kind==='error'?'× ':kind==='warn'?'! ':'✓ ')+message;$('checks').append(e);}}
const fmt=(x,n=2)=>Number.isFinite(x)?x.toFixed(n):'—';
function updateDiagnostics(){
 const r=result;$('gridInfo').textContent=`dx ${fmt(r.dx)} m · dy ${fmt(r.dy)} m · ${(r.nx*r.ny).toLocaleString()} cells`;
 $('mGrid').textContent=`${r.nx} × ${r.ny}`;$('mDepth').textContent=fmt(r.meanDepth)+' m';$('mWet').textContent=fmt(r.wetFraction*100,1)+'%';
 $('zlow').textContent=fmt(r.zmin);$('zhigh').textContent=fmt(r.zmax);
 $('waveInfo').innerHTML=`T <b>${fmt(r.T)} s</b> · L <b>${fmt(r.L)} m</b><br>Generation depth ${fmt(r.generationDepth)} m<br>H/h ${fmt(r.H/r.generationDepth,3)} · H/L ${fmt(r.H/r.L,3)}<br>Cells per wavelength: ${fmt(r.resolution,1)} cells<br><small>Celeris approximate L ≈ ${fmt(r.solverL)} m</small>`;
 const rel=r.relative;$('regimeText').textContent=`h̄/L = ${fmt(rel,3)} · ${rel<.05?'Shallow-water / long waves':rel<=.5?'Intermediate-depth waves':'Deep-water waves'}`;
 const percent=rel<.05?33.33*rel/.05:rel<.5?33.33+33.33*(rel-.05)/.45:66.66+33.33*Math.min(1,(rel-.5)/.5);$('regimeMarker').style.left=Math.min(99,percent)+'%';
 for(const option of $('boundary').options){const b=r.boundaries[option.value];option.disabled=b.minDepth<=1e-4||b.blocked;}
 if(r.generationDepth<=1e-4){$('waveInfo').textContent='The generation zone is dry. Wavelength and relative depth are unavailable.';$('regimeText').textContent='Unavailable · Wet generation zone required';$('regimeMarker').style.display='none';}else{$('regimeMarker').style.display='block';}
 checks(r.errors,r.warnings);
}
function color(v){const r=result;let t=r.zmax===r.zmin?(v>=0?.95:.25):(v-r.zmin)/(r.zmax-r.zmin);const stops=[[20,59,102],[32,142,172],[106,199,192],[232,217,160],[143,105,72]];t=Math.max(0,Math.min(.99999,t))*4;const i=Math.floor(t),f=t-i;return stops[i].map((v,j)=>Math.round(v*(1-f)+stops[i+1][j]*f));}
function makeRaster(){const r=result;raster.width=r.nx;raster.height=r.ny;const c=raster.getContext('2d'),im=c.createImageData(r.nx,r.ny);for(let j=0;j<r.ny;j++)for(let i=0;i<r.nx;i++){const p=((r.ny-1-j)*r.nx+i)*4;im.data.set([...color(r.z[j*r.nx+i]),255],p);}c.putImageData(im,0,0);coast.width=r.nx;coast.height=r.ny;const cc=coast.getContext('2d');cc.strokeStyle='#ffffffaa';cc.lineWidth=.5;cc.beginPath();for(let j=0;j<r.ny;j++)for(let i=0;i<r.nx;i++){const v=r.z[j*r.nx+i]>=0,y=r.ny-j;if(i+1<r.nx&&v!==(r.z[j*r.nx+i+1]>=0)){cc.moveTo(i+1,y);cc.lineTo(i+1,y-1);}if(j+1<r.ny&&v!==(r.z[(j+1)*r.nx+i]>=0)){cc.moveTo(i,y-1);cc.lineTo(i+1,y-1);}}cc.stroke();}
function setupCanvas(id){const canvas=$(id),dpr=window.devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight;if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);return {c,w,h};}
function drawMap(){const {c,w,h}=setupCanvas('map');if(!result){c.fillStyle='#6d8289';c.font='13px system-ui';c.fillText('Preparing the Python engine…',25,h/2);return;}
 const r=result,lx=r.nx*r.dx,ly=r.ny*r.dy;const base=Math.min((w-70)/lx,(h-65)/ly),scale=base*zoom,W=lx*scale,H=ly*scale,X=(w-W)/2+panX,Y=(h-H)/2+panY;transform={X,Y,W,H,lx,ly};
 c.save();c.beginPath();c.rect(0,0,w,h);c.clip();c.imageSmoothingEnabled=false;c.drawImage(raster,X,Y,W,H);
 if($('showGrid').checked){const step=Math.max(1,Math.ceil(5/Math.min(W/r.nx,H/r.ny)));c.lineWidth=.5;c.strokeStyle='rgba(15,50,65,.28)';c.beginPath();for(let i=0;i<=r.nx;i+=step){const x=X+i/r.nx*W;c.moveTo(x,Y);c.lineTo(x,Y+H);}for(let j=0;j<=r.ny;j+=step){const y=Y+j/r.ny*H;c.moveTo(X,y);c.lineTo(X+W,y);}c.stroke();}
 c.drawImage(coast,X,Y,W,H);
 if($('showWave').checked&&r.generationDepth>1e-4&&r.wetFraction>0){c.save();c.beginPath();c.rect(X,Y,W,H);c.clip();const a=r.theta,co=Math.cos(a),sn=Math.sin(a),lambda=r.L*scale;const extent=Math.hypot(W,H),stride=lambda*Math.max(1,Math.ceil(extent/lambda/100));const shift=(phaseTime/r.T*lambda)%stride;c.strokeStyle='#ffffff70';c.lineWidth=1.3;for(let q=-extent+shift;q<=extent;q+=stride){const px=X+W/2+q*co,py=Y+H/2-q*sn;c.beginPath();c.moveTo(px-extent*sn,py-extent*co);c.lineTo(px+extent*sn,py+extent*co);c.stroke();}c.restore();
 const ax=X+W*.22,ay=Y+H*.23,len=50,ex=ax+len*co,ey=ay-len*sn;c.strokeStyle='#123f4b';c.fillStyle='#123f4b';c.lineWidth=3;c.beginPath();c.moveTo(ax,ay);c.lineTo(ex,ey);c.stroke();c.beginPath();c.moveTo(ex,ey);c.lineTo(ex-12*co+6*sn,ey+12*sn+6*co);c.lineTo(ex-12*co-6*sn,ey+12*sn-6*co);c.fill();}
 c.strokeStyle='#0a7872';c.lineWidth=4;c.beginPath();const side=s.boundary;if(side==='west'){c.moveTo(X,Y);c.lineTo(X,Y+H);}if(side==='east'){c.moveTo(X+W,Y);c.lineTo(X+W,Y+H);}if(side==='south'){c.moveTo(X,Y+H);c.lineTo(X+W,Y+H);}if(side==='north'){c.moveTo(X,Y);c.lineTo(X+W,Y);}c.stroke();
 c.setLineDash([5,5]);c.strokeStyle='#20394399';c.lineWidth=1;c.beginPath();c.moveTo(X,Y+H-(selectedJ+.5)/r.ny*H);c.lineTo(X+W,Y+H-(selectedJ+.5)/r.ny*H);c.stroke();c.setLineDash([]);
 c.fillStyle='#425b65';c.font='10px system-ui';c.fillText('0',X-12,Y+H+15);c.fillText(`${fmt(lx,0)} m  → x`,X+W-70,Y+H+17);c.fillText(`↑ y   ${fmt(ly,0)} m`,X,Y-10);c.restore();
}
function drawSection(){const {c,w,h}=setupCanvas('section');if(!result)return;const r=result,j=Math.max(0,Math.min(r.ny-1,selectedJ));const low=Math.min(r.zmin,-.1),high=Math.max(r.zmax,1),sy=v=>h-20-(v-low)/(high-low)*(h-35);c.fillStyle='#e5f4f7';c.fillRect(30,sy(0),w-40,h-20-sy(0));c.beginPath();c.moveTo(30,h-20);for(let i=0;i<r.nx;i++)c.lineTo(30+i/(r.nx-1)*(w-40),sy(r.z[j*r.nx+i]));c.lineTo(w-10,h-20);c.closePath();c.fillStyle='#b4a88d';c.fill();c.strokeStyle='#46767f';c.beginPath();c.moveTo(30,sy(0));c.lineTo(w-10,sy(0));c.stroke();c.fillStyle='#6d8289';c.font='10px system-ui';c.fillText('0 m',0,sy(0)+3);$('sectionAt').textContent=`j = ${j} · y = ${fmt((j+.5)*r.dy)} m`;}
function drawSine(){const {c,w,h}=setupCanvas('sine');if(!result||result.generationDepth<=1e-4)return;const r=result;c.strokeStyle='#dbe5e7';c.beginPath();c.moveTo(0,h/2);c.lineTo(w,h/2);c.stroke();c.strokeStyle='#0a7872';c.lineWidth=2;c.beginPath();for(let x=0;x<w;x++){const y=h/2-25*Math.sin(2*Math.PI*(phaseTime/r.T-x/w*2)+r.phase);x?c.lineTo(x,y):c.moveTo(x,y);}c.stroke();c.fillStyle='#6d8289';c.font='10px system-ui';c.fillText(`H = ${fmt(r.H)} m · Display width 2L`,4,12);}
function animate(t){if(playing&&lastTime)phaseTime+=(t-lastTime)/1000;lastTime=t;drawMap();drawSine();drawSection();requestAnimationFrame(animate);}
$('map').onwheel=e=>{e.preventDefault();zoom=Math.max(1,Math.min(12,zoom*(e.deltaY<0?1.15:1/1.15)));if(zoom===1){panX=panY=0;}};
$('map').onpointerdown=e=>{drag={x:e.clientX,y:e.clientY,px:panX,py:panY};$('map').setPointerCapture(e.pointerId);};
$('map').onpointermove=e=>{if(drag){panX=drag.px+e.clientX-drag.x;panY=drag.py+e.clientY-drag.y;}if(!transform||!result)return;const rect=$('map').getBoundingClientRect(),t=transform;const i=Math.floor((e.clientX-rect.left-t.X)/t.W*result.nx),j=Math.floor((1-(e.clientY-rect.top-t.Y)/t.H)*result.ny);if(i>=0&&i<result.nx&&j>=0&&j<result.ny){const z=result.z[j*result.nx+i];$('hover').textContent=`i ${i} · j ${j} | x ${fmt((i+.5)*result.dx)} · y ${fmt((j+.5)*result.dy)} m | z ${fmt(z)} m · h ${fmt(Math.max(0,-z))} m`;}};
$('map').onpointerup=e=>{if(drag&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<4&&result&&transform){const rect=$('map').getBoundingClientRect();selectedJ=Math.max(0,Math.min(result.ny-1,Math.floor((1-(e.clientY-rect.top-transform.Y)/transform.H)*result.ny)));}drag=null;};
$('map').onpointercancel=()=>drag=null;
$('resetView').onclick=()=>{zoom=1;panX=panY=0;};$('play').onclick=()=>{playing=!playing;$('play').textContent=playing?'Ⅱ Pause':'▷ Play';};
$('add').onclick=()=>{if(s.breakwaters.length>=30)return;s.breakwaters.push({enabled:true,i:Math.floor(s.nx*.6),j:Math.floor(s.ny*.5),length:Math.min(s.lx,s.ly)*.3,thickness:Math.max(s.lx/s.nx,s.ly/s.ny)*3,angle:90,crest:2});changed();};
$('save').onclick=()=>{if(busy||pending||!result||result.errors.length||previewId!==revision)return;busy=true;$('save').disabled=true;document.querySelectorAll('aside input,aside select,#breakwaters button,#add,#load').forEach(x=>x.disabled=true);worker.postMessage({type:'export',id:revision,settings:structuredClone(s)});};
$('load').onclick=()=>$('file').click();$('file').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>1000000)throw Error('Settings files must be no larger than 1 MB.');const obj=JSON.parse(await f.text());if(obj.schemaVersion!==1||!Array.isArray(obj.breakwaters))throw Error('Invalid case_settings.json format.');const clean={};for(const k of Object.keys(defaults)){if(!(k in obj))throw Error('Missing setting: '+k);clean[k]=obj[k];}for(const [k,v] of Object.entries(defaults)){if(typeof v==='number'&&(clean[k]===null||typeof clean[k]==='object'||!Number.isFinite(Number(clean[k]))))throw Error('Invalid numeric setting: '+k);}if(clean.breakwaters.length>30)throw Error('A maximum of 30 breakwaters is supported.');for(const b of clean.breakwaters){if(!b||typeof b.enabled!=='boolean'||['i','j','length','thickness','angle','crest'].some(k=>typeof b[k]!=='number'||!Number.isFinite(b[k])))throw Error('Invalid breakwater settings');}s=clean;selectedJ=Math.floor(s.ny/2);zoom=1;panX=panY=0;changed();}catch(err){$('log').textContent='Failed to load settings';checks([String(err.message)],[]);}finally{e.target.value='';}};
controls();requestPreview();requestAnimationFrame(animate);
