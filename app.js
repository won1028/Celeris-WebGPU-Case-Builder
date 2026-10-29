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
 else {input.type='number';input.step=opts.step||'any';if(opts.min!==undefined)input.min=opts.min;if(opts.max!==undefined)input.max=opts.max;}
 input.value=s[key];const update=()=>{if(key==='waveMode'&&result&&!result.errors.length)s.waveInput=input.value==='period'?result.T:result.L;s[key]=opts.options?input.value:(input.value===''?null:Number(input.value));if(['nx','ny'].includes(key))selectedJ=Math.floor(s.ny/2);changed(!!opts.options);}; if(opts.options) input.onchange=update; else input.oninput=update;
 wrap.append(input);$(parent).append(wrap);
}
function controls(){
 for(const id of ['gridFields','terrainFields','waveFields','configFields'])$(id).replaceChildren();
 field('gridFields','nx','nx · x 격자 수',{step:1,min:16,max:2048});field('gridFields','ny','ny · y 격자 수',{step:1,min:16,max:2048});
 field('gridFields','lx','도메인 Lx (m)',{min:.01});field('gridFields','ly','도메인 Ly (m)',{min:.01});
 field('terrainFields','terrain','지형 형태',{full:true,options:[['flat','일정 수심'],['slope','단일 경사면'],['step','계단형'],['terrace','3단 계단형'],['bar','Gaussian 사주'],['channel','Gaussian 수로'],['island','원뿔형 섬']]});
 field('terrainFields','depth','기준 수심 (m)',{min:.001});field('terrainFields','terrainAngle','상승 / 폭 방향 (°)');
 field('terrainFields','slope','경사 Δz / Δx');field('terrainFields','position','시작 위치 (0–1)',{min:0,max:1});
 field('terrainFields','height','지형 높이 / 단차 (m)');field('terrainFields','width','폭 σ / 단 폭 / 반경 (m)',{min:.001});
 field('terrainFields','cx','중심 x / Lx (0–1)',{min:0,max:1});field('terrainFields','cy','중심 y / Ly (0–1)',{min:0,max:1});
 field('waveFields','boundary','입사 경계',{full:true,options:[['west','서쪽 · x = 0'],['east','동쪽 · x = Lx'],['south','남쪽 · y = 0'],['north','북쪽 · y = Ly']]});
 field('waveFields','direction','파 진행각 (°)');field('waveFields','waveHeight','파고 H (m)',{min:.00001});
 field('waveFields','waveMode','입력 기준',{full:true,options:[['period','주기 T → 파장 자동 계산'],['length','파장 L → 주기 자동 계산']]});
 field('waveFields','waveInput',s.waveMode==='period'?'주기 T (s)':'파장 L (m)',{min:.001});field('waveFields','phase','초기 위상 (°)');
 field('configFields','solver','지배방정식',{full:true,options:[['1','Boussinesq'],['0','NLSW · 장파']]});
 field('configFields','courant','Courant 수',{min:.001,max:.5});field('configFields','friction','Manning n',{min:0,max:1});
 field('configFields','otherBoundary','나머지 경계',{full:true,options:[['sponge','흡수층 (Sponge)'],['wall','반사벽 (Wall)']]});
 // Dependent fields are disabled instead of leaving inactive parameters ambiguous.
 const active={flat:['depth'],slope:['depth','terrainAngle','slope','position'],step:['depth','terrainAngle','height','position'],terrace:['depth','terrainAngle','height','position','width'],bar:['depth','terrainAngle','height','width','cx','cy'],channel:['depth','terrainAngle','height','width','cx','cy'],island:['depth','height','width','cx','cy']}[s.terrain]||[];
 for(const key of ['depth','terrainAngle','slope','position','height','width','cx','cy'])$(key).disabled=!active.includes(key);
 $('terrainHelp').textContent={flat:'바닥표고 z = −기준 수심.',slope:'시작 위치 이후에 지정 방향으로 상승합니다. 경사 0.05 = 1:20.',step:'시작 위치를 경계로 바닥표고가 단차만큼 변합니다.',terrace:'시작 위치 이후 단 폭 간격으로 3개의 단차를 만듭니다.',bar:'중심선에 지형 높이를 더합니다. 폭은 Gaussian 표준편차 σ입니다.',channel:'중심선에서 |지형 높이|만큼 깊어집니다. 폭은 표준편차 σ입니다.',island:'중심에서 지형 높이가 최대이며 반경 밖은 기준 수심입니다.'}[s.terrain];
 renderBreakwaters();
}
function renderBreakwaters(){
 $('breakwaters').replaceChildren();
 if(!s.breakwaters.length){const p=document.createElement('p');p.className='help';p.textContent='방파제 없음 · ＋ 추가로 구조물을 배치하세요.';$('breakwaters').append(p);}
 s.breakwaters.forEach((b,index)=>{
  const box=document.createElement('div');box.className='bw';
  const head=document.createElement('div');head.className='bwHead';const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=b.enabled;check.onchange=()=>{b.enabled=check.checked;changed();};label.append(check,` 방파제 ${index+1} · ${b.crest<0?'잠제':'수면 위'}`);
  const remove=document.createElement('button');remove.textContent='삭제';remove.onclick=()=>{s.breakwaters.splice(index,1);changed();};head.append(label,remove);box.append(head);
  const fields=document.createElement('div');fields.className='fields';
  for(const [key,text] of [['i','중심 i (0-based)'],['j','중심 j (0-based)'],['length','길이 (m)'],['thickness','두께 (m)'],['angle','방향각 (°)'],['crest','마루표고 (m)']]){
   const l=document.createElement('label');l.className='field';const span=document.createElement('span');span.textContent=text;const inp=document.createElement('input');inp.type='number';inp.step=['i','j'].includes(key)?1:'any';inp.value=b[key];inp.disabled=!b.enabled;inp.oninput=()=>{b[key]=inp.value===''?null:Number(inp.value);changed(false);};l.append(span,inp);fields.append(l);
  }box.append(fields);$('breakwaters').append(box);
 });
}
function changed(rebuild=true){revision++;$('save').disabled=true;$('log').textContent='설정 변경 · 계산 대기 중…';if(rebuild)controls();clearTimeout(timer);timer=setTimeout(requestPreview,200);}
function requestPreview(){
 const req={type:'preview',id:revision,settings:structuredClone(s)};
 if(pending||busy){queued=req;return;}
 pending=true;previewId=req.id;$('log').textContent='지형과 조파 조건 계산 중…';worker.postMessage(req);
}
function next(){if(queued&&!busy){const req=queued;queued=null;pending=true;previewId=req.id;worker.postMessage(req);}}
worker.onmessage=({data})=>{
 if(data.type==='log'){$('log').textContent=data.message;return;}
 if(data.type==='preview'){
  pending=false;if(data.id===revision){result=data.result;makeRaster();updateDiagnostics();$('log').textContent=result.errors.length?'입력 조건을 수정하세요.':'입력 검증 완료';$('save').disabled=!!result.errors.length;}
  next();
 }else if(data.type==='error'){
  pending=false;busy=false;document.querySelectorAll('aside input,aside select,#breakwaters button,#add,#load').forEach(x=>x.disabled=false);controls();$('save').disabled=true;$('log').textContent='실행 실패';checks([data.message],[]);next();
 }else if(data.type==='export'){
  const blob=new Blob([data.bytes],{type:'application/zip'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='celeris_case.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  busy=false;controls();$('add').disabled=false;$('load').disabled=false;$('save').disabled=false;$('log').textContent='ZIP 생성 완료 · 다운로드를 시작했습니다.';next();
 }
};
worker.onerror=e=>{$('log').textContent='Python 초기화 실패';checks(['브라우저가 Python 실행환경을 불러오지 못했습니다. 인터넷 연결/CDN 접근을 확인하고 새로고침하세요. '+e.message],[]);};
function checks(errors,warnings){$('checks').replaceChildren();for(const [kind,messages] of [['error',errors],['warn',warnings],['good',errors.length?[]:['조파 경계와 파일 생성 조건을 통과했습니다.']]])for(const message of messages){const e=document.createElement('div');e.className='check '+kind;e.textContent=(kind==='error'?'× ':kind==='warn'?'! ':'✓ ')+message;$('checks').append(e);}}
const fmt=(x,n=2)=>Number.isFinite(x)?x.toFixed(n):'—';
function updateDiagnostics(){
 const r=result;$('gridInfo').textContent=`dx ${fmt(r.dx)} m · dy ${fmt(r.dy)} m · ${(r.nx*r.ny).toLocaleString()} cells`;
 $('mGrid').textContent=`${r.nx} × ${r.ny}`;$('mDepth').textContent=fmt(r.meanDepth)+' m';$('mWet').textContent=fmt(r.wetFraction*100,1)+'%';
 $('zlow').textContent=fmt(r.zmin);$('zhigh').textContent=fmt(r.zmax);
 $('waveInfo').innerHTML=`T <b>${fmt(r.T)} s</b> · L <b>${fmt(r.L)} m</b><br>조파 수심 ${fmt(r.generationDepth)} m<br>H/h ${fmt(r.H/r.generationDepth,3)} · H/L ${fmt(r.H/r.L,3)}<br>파장당 ${fmt(r.resolution,1)} cells<br><small>Celeris 근사식 L ≈ ${fmt(r.solverL)} m</small>`;
 const rel=r.relative;$('regimeText').textContent=`h̄/L = ${fmt(rel,3)} · ${rel<.05?'천해파 / 장파':rel<=.5?'중간수심파':'심해파'}`;
 const percent=rel<.05?33.33*rel/.05:rel<.5?33.33+33.33*(rel-.05)/.45:66.66+33.33*Math.min(1,(rel-.5)/.5);$('regimeMarker').style.left=Math.min(99,percent)+'%';
 for(const option of $('boundary').options){const b=r.boundaries[option.value];option.disabled=b.minDepth<=1e-4||b.blocked;}
 if(r.generationDepth<=1e-4){$('waveInfo').textContent='조파 구간이 dry입니다. 유효한 파장/상대수심을 계산할 수 없습니다.';$('regimeText').textContent='판정 불가 · 조파 수심 필요';$('regimeMarker').style.display='none';}else{$('regimeMarker').style.display='block';}
 checks(r.errors,r.warnings);
}
function color(v){const r=result;let t=r.zmax===r.zmin?(v>=0?.95:.25):(v-r.zmin)/(r.zmax-r.zmin);const stops=[[20,59,102],[32,142,172],[106,199,192],[232,217,160],[143,105,72]];t=Math.max(0,Math.min(.99999,t))*4;const i=Math.floor(t),f=t-i;return stops[i].map((v,j)=>Math.round(v*(1-f)+stops[i+1][j]*f));}
function makeRaster(){const r=result;raster.width=r.nx;raster.height=r.ny;const c=raster.getContext('2d'),im=c.createImageData(r.nx,r.ny);for(let j=0;j<r.ny;j++)for(let i=0;i<r.nx;i++){const p=((r.ny-1-j)*r.nx+i)*4;im.data.set([...color(r.z[j*r.nx+i]),255],p);}c.putImageData(im,0,0);coast.width=r.nx;coast.height=r.ny;const cc=coast.getContext('2d');cc.strokeStyle='#ffffffaa';cc.lineWidth=.5;cc.beginPath();for(let j=0;j<r.ny;j++)for(let i=0;i<r.nx;i++){const v=r.z[j*r.nx+i]>=0,y=r.ny-j;if(i+1<r.nx&&v!==(r.z[j*r.nx+i+1]>=0)){cc.moveTo(i+1,y);cc.lineTo(i+1,y-1);}if(j+1<r.ny&&v!==(r.z[(j+1)*r.nx+i]>=0)){cc.moveTo(i,y-1);cc.lineTo(i+1,y-1);}}cc.stroke();}
function setupCanvas(id){const canvas=$(id),dpr=window.devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight;if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);return {c,w,h};}
function drawMap(){const {c,w,h}=setupCanvas('map');if(!result){c.fillStyle='#6d8289';c.font='13px system-ui';c.fillText('Python 엔진을 준비하고 있습니다…',25,h/2);return;}
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
function drawSine(){const {c,w,h}=setupCanvas('sine');if(!result||result.generationDepth<=1e-4)return;const r=result;c.strokeStyle='#dbe5e7';c.beginPath();c.moveTo(0,h/2);c.lineTo(w,h/2);c.stroke();c.strokeStyle='#0a7872';c.lineWidth=2;c.beginPath();for(let x=0;x<w;x++){const y=h/2-25*Math.sin(2*Math.PI*(phaseTime/r.T-x/w*2)+r.phase);x?c.lineTo(x,y):c.moveTo(x,y);}c.stroke();c.fillStyle='#6d8289';c.font='10px system-ui';c.fillText(`H = ${fmt(r.H)} m · 표시 폭 2L`,4,12);}
function animate(t){if(playing&&lastTime)phaseTime+=(t-lastTime)/1000;lastTime=t;drawMap();drawSine();drawSection();requestAnimationFrame(animate);}
$('map').onwheel=e=>{e.preventDefault();zoom=Math.max(1,Math.min(12,zoom*(e.deltaY<0?1.15:1/1.15)));if(zoom===1){panX=panY=0;}};
$('map').onpointerdown=e=>{drag={x:e.clientX,y:e.clientY,px:panX,py:panY};$('map').setPointerCapture(e.pointerId);};
$('map').onpointermove=e=>{if(drag){panX=drag.px+e.clientX-drag.x;panY=drag.py+e.clientY-drag.y;}if(!transform||!result)return;const rect=$('map').getBoundingClientRect(),t=transform;const i=Math.floor((e.clientX-rect.left-t.X)/t.W*result.nx),j=Math.floor((1-(e.clientY-rect.top-t.Y)/t.H)*result.ny);if(i>=0&&i<result.nx&&j>=0&&j<result.ny){const z=result.z[j*result.nx+i];$('hover').textContent=`i ${i} · j ${j} | x ${fmt((i+.5)*result.dx)} · y ${fmt((j+.5)*result.dy)} m | z ${fmt(z)} m · h ${fmt(Math.max(0,-z))} m`;}};
$('map').onpointerup=e=>{if(drag&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<4&&result&&transform){const rect=$('map').getBoundingClientRect();selectedJ=Math.max(0,Math.min(result.ny-1,Math.floor((1-(e.clientY-rect.top-transform.Y)/transform.H)*result.ny)));}drag=null;};
$('map').onpointercancel=()=>drag=null;
$('resetView').onclick=()=>{zoom=1;panX=panY=0;};$('play').onclick=()=>{playing=!playing;$('play').textContent=playing?'Ⅱ 일시정지':'▷ 재생';};
$('add').onclick=()=>{if(s.breakwaters.length>=30)return;s.breakwaters.push({enabled:true,i:Math.floor(s.nx*.6),j:Math.floor(s.ny*.5),length:Math.min(s.lx,s.ly)*.3,thickness:Math.max(s.lx/s.nx,s.ly/s.ny)*3,angle:90,crest:2});changed();};
$('save').onclick=()=>{if(busy||pending||!result||result.errors.length||previewId!==revision)return;busy=true;$('save').disabled=true;document.querySelectorAll('aside input,aside select,#breakwaters button,#add,#load').forEach(x=>x.disabled=true);worker.postMessage({type:'export',id:revision,settings:structuredClone(s)});};
$('load').onclick=()=>$('file').click();$('file').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>1000000)throw Error('설정 파일은 1 MB 이하로 제한됩니다.');const obj=JSON.parse(await f.text());if(obj.schemaVersion!==1||!Array.isArray(obj.breakwaters))throw Error('case_settings.json 형식이 아닙니다.');const clean={};for(const k of Object.keys(defaults)){if(!(k in obj))throw Error('설정 누락: '+k);clean[k]=obj[k];}for(const [k,v] of Object.entries(defaults)){if(typeof v==='number'&&(clean[k]===null||typeof clean[k]==='object'||!Number.isFinite(Number(clean[k]))))throw Error('숫자 설정 오류: '+k);}if(clean.breakwaters.length>30)throw Error('방파제는 최대 30개입니다.');for(const b of clean.breakwaters){if(!b||typeof b.enabled!=='boolean'||['i','j','length','thickness','angle','crest'].some(k=>typeof b[k]!=='number'||!Number.isFinite(b[k])))throw Error('방파제 설정 형식 오류');}s=clean;selectedJ=Math.floor(s.ny/2);zoom=1;panX=panY=0;changed();}catch(err){$('log').textContent='불러오기 실패';checks([String(err.message)],[]);}finally{e.target.value='';}};
controls();requestPreview();requestAnimationFrame(animate);
