const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const state = {
  sourceFile:null, sourceImg:null, sourceUrl:null, bgImg:null, bgUrl:null, modelLoaded:false, mode:'keep', preset:'white', ratio:'original',
  feather:2, shadow:35, scale:1, x:.5, y:.5, bgBlur:0, brightness:100, saturation:100, clarity:100, compare:50, previewZoom:1,
  brushSize:42, brushMode:'erase', maskCanvas:null, removeMaskCanvas:null, removedResult:null,
  history:[], redo:[], cutoutReady:false, compareOn:true
};
const els = {
  uploadCard:$('#uploadCard'), editor:$('#editor'), input:$('#imageInput'), bgInput:$('#bgInput'), drop:$('#dropZone'),
  out:$('#outputCanvas'), before:$('#beforeCanvas'), overlay:$('#overlayCanvas'), draw:$('#drawCanvas'), stage:$('#stage'), shell:$('#stageShell'),
  processing:$('#processing'), processingText:$('#processingText'), progress:$('#progressBar'), badge:$('#stageBadge'), compareLine:$('#compareLine')
};
const outCtx = els.out.getContext('2d',{willReadFrequently:true});
const beforeCtx = els.before.getContext('2d');
const overlayCtx = els.overlay.getContext('2d');
const drawCtx = els.draw.getContext('2d');
let brushing=false, lastPt=null, pendingRender=0;

function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._x);t._x=setTimeout(()=>t.classList.remove('show'),1800)}
function showProcessing(text='Processing on your device…'){els.processingText.textContent=text;els.progress.style.width='8%';els.processing.classList.add('active')}
function hideProcessing(){els.processing.classList.remove('active');els.progress.style.width='0%'}
function updateProgress(p){els.progress.style.width=Math.max(8,Math.min(100,p))+'%'}
function setModelStatus(kind,text){const el=$('#modelStatus');if(!el)return;el.className='model-status '+kind;el.querySelector('span').textContent=text}
function imgFromUrl(url){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=url})}
function canvas(w,h){const c=document.createElement('canvas');c.width=Math.max(1,Math.round(w));c.height=Math.max(1,Math.round(h));return c}
function fitSize(iw,ih,max=1200){const s=Math.min(1,max/Math.max(iw,ih));return [Math.round(iw*s),Math.round(ih*s)]}
function snapshot(){state.history.push({mode:state.mode,preset:state.preset,ratio:state.ratio,feather:state.feather,shadow:state.shadow,scale:state.scale,x:state.x,y:state.y,bgBlur:state.bgBlur,brightness:state.brightness,saturation:state.saturation,clarity:state.clarity});if(state.history.length>30)state.history.shift();state.redo=[]}
function restoreSnap(s){Object.assign(state,s);syncControls();render()}
function undo(){if(!state.history.length)return;state.redo.push({mode:state.mode,preset:state.preset,ratio:state.ratio,feather:state.feather,shadow:state.shadow,scale:state.scale,x:state.x,y:state.y,bgBlur:state.bgBlur,brightness:state.brightness,saturation:state.saturation,clarity:state.clarity});restoreSnap(state.history.pop())}
function redo(){if(!state.redo.length)return;state.history.push({mode:state.mode,preset:state.preset,ratio:state.ratio,feather:state.feather,shadow:state.shadow,scale:state.scale,x:state.x,y:state.y,bgBlur:state.bgBlur,brightness:state.brightness,saturation:state.saturation,clarity:state.clarity});restoreSnap(state.redo.pop())}

async function loadSource(file){
  if(!file)return;
  if(!/^image\/(jpeg|png|webp)$/.test(file.type)){toast('Use JPG, PNG or WebP');return}
  if(state.sourceUrl)URL.revokeObjectURL(state.sourceUrl);
  state.sourceFile=file;state.sourceUrl=URL.createObjectURL(file);state.sourceImg=await imgFromUrl(state.sourceUrl);state.cutoutReady=false;state.removedResult=null;state.bgImg=null;
  initMasks();state.history=[];state.redo=[];
  els.uploadCard.style.display='none';els.editor.classList.add('active');$('#bottomActions').classList.add('active');
  render();toast('Photo ready — detecting bike');
  setTimeout(()=>autoCutout(true),80);
}
function initMasks(){
  const [mw,mh]=fitSize(state.sourceImg.naturalWidth,state.sourceImg.naturalHeight,1600);
  state.maskCanvas=canvas(mw,mh);const m=state.maskCanvas.getContext('2d');m.fillStyle='#fff';m.fillRect(0,0,mw,mh);
  state.removeMaskCanvas=canvas(mw,mh);const r=state.removeMaskCanvas.getContext('2d');r.fillStyle='#000';r.fillRect(0,0,mw,mh);
}
function outputDims(maxSide=1300){
  const iw=state.sourceImg.naturalWidth, ih=state.sourceImg.naturalHeight; let w=iw,h=ih;
  if(state.ratio!=='original'){
    const [a,b]=state.ratio.split(':').map(Number);const r=a/b;
    if(iw/ih>r){h=ih;w=h*r}else{w=iw;h=w/r}
  }
  const s=Math.min(1,maxSide/Math.max(w,h));
  return [Math.max(1,Math.round(w*s)),Math.max(1,Math.round(h*s))];
}
function coverRect(iw,ih,w,h){const s=Math.max(w/iw,h/ih);return [(w-iw*s)/2,(h-ih*s)/2,iw*s,ih*s]}
function containRect(iw,ih,w,h,scale=1,x=.5,y=.5){const s=Math.min(w/iw,h/ih)*scale;const dw=iw*s,dh=ih*s;return [(w-dw)*x,(h-dh)*y,dw,dh]}
function drawProcedural(ctx,w,h,preset){
  ctx.save();
  const g=(a,b,c,d)=>{const x=ctx.createLinearGradient(0,0,0,h);x.addColorStop(0,a);x.addColorStop(.58,b);x.addColorStop(1,c||b);ctx.fillStyle=x;ctx.fillRect(0,0,w,h);if(d){ctx.fillStyle=d;ctx.fillRect(0,h*.7,w,h*.3)}};
  if(preset==='white'){
    const rg=ctx.createRadialGradient(w*.5,h*.35,0,w*.5,h*.45,Math.max(w,h)*.68);rg.addColorStop(0,'#fff');rg.addColorStop(.62,'#f3f3f3');rg.addColorStop(1,'#cfcfcf');ctx.fillStyle=rg;ctx.fillRect(0,0,w,h);ctx.fillStyle='#dedede';ctx.fillRect(0,h*.72,w,h*.28);
  } else if(preset==='dark'){
    const rg=ctx.createRadialGradient(w*.5,h*.34,0,w*.5,h*.4,Math.max(w,h)*.7);rg.addColorStop(0,'#3a3a3a');rg.addColorStop(.56,'#141414');rg.addColorStop(1,'#020202');ctx.fillStyle=rg;ctx.fillRect(0,0,w,h);ctx.fillStyle='#0a0a0a';ctx.fillRect(0,h*.73,w,h*.27);
  } else if(preset==='sunset'){
    g('#ff9061','#8d4c70','#1b2340','#171717');ctx.fillStyle='rgba(255,202,121,.78)';ctx.beginPath();ctx.arc(w*.72,h*.33,Math.min(w,h)*.09,0,Math.PI*2);ctx.fill();
  } else if(preset==='mountains'){
    g('#76c6ed','#d6edf4','#b7ced2');
    const ridge=(y,amp,color,seed)=>{ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(0,h);ctx.lineTo(0,y);for(let x=0;x<=w;x+=w/9){const yy=y-Math.abs(Math.sin(x*.018+seed))*amp-(Math.sin(x*.047+seed)*amp*.32);ctx.lineTo(x,yy)}ctx.lineTo(w,h);ctx.closePath();ctx.fill()};
    ridge(h*.58,h*.18,'#7d9896',1);ridge(h*.68,h*.2,'#3f6259',2.2);ridge(h*.78,h*.16,'#233c31',4);
  } else if(preset==='workshop'){
    g('#3a3a3a','#1b1b1b','#111','#191919');ctx.fillStyle='rgba(255,255,255,.055)';for(let x=0;x<w;x+=w/10)ctx.fillRect(x,0,2,h*.7);ctx.fillStyle='#3b3b3b';ctx.fillRect(0,h*.68,w,3);ctx.fillStyle='#111';for(let x=0;x<w;x+=w/5){ctx.fillRect(x,h*.69,w/10,h*.31)}
  } else if(preset==='garage'){
    g('#232323','#111','#0b0b0b','#2b2b2b');ctx.fillStyle='rgba(237,28,36,.55)';ctx.fillRect(0,h*.12,w,h*.012);ctx.fillStyle='rgba(255,255,255,.08)';for(let x=w*.12;x<w;x+=w*.25){ctx.fillRect(x,h*.18,w*.08,h*.38)}
  } else if(preset==='red'){
    const rg=ctx.createRadialGradient(w*.35,h*.28,0,w*.45,h*.44,Math.max(w,h)*.8);rg.addColorStop(0,'#6a2226');rg.addColorStop(.52,'#241214');rg.addColorStop(1,'#090909');ctx.fillStyle=rg;ctx.fillRect(0,0,w,h);ctx.fillStyle='#111';ctx.fillRect(0,h*.72,w,h*.28)
  } else {
    g('#555','#252525','#171717','#222');const id=ctx.createImageData(Math.min(w,900),Math.min(h,900));for(let i=0;i<id.data.length;i+=4){const n=25+Math.random()*42;id.data[i]=id.data[i+1]=id.data[i+2]=n;id.data[i+3]=38}const nc=canvas(id.width,id.height);nc.getContext('2d').putImageData(id,0,0);ctx.globalAlpha=.45;ctx.drawImage(nc,0,0,w,h);ctx.globalAlpha=1;ctx.fillStyle='#161616';ctx.fillRect(0,h*.7,w,h*.3)
  }
  ctx.restore();
}
function drawBackground(ctx,w,h){
  const tmp=canvas(w,h),t=tmp.getContext('2d');
  if(state.bgImg){const r=coverRect(state.bgImg.naturalWidth,state.bgImg.naturalHeight,w,h);t.drawImage(state.bgImg,...r)} else drawProcedural(t,w,h,state.preset);
  ctx.save();ctx.filter=`blur(${state.bgBlur}px) brightness(${state.brightness}%) saturate(${state.saturation}%) contrast(${state.clarity}%)`;const pad=state.bgBlur*2;ctx.drawImage(tmp,-pad,-pad,w+pad*2,h+pad*2);ctx.restore();
}
function makeSubjectComposite(targetW,targetH){
  const sw=state.sourceImg.naturalWidth, sh=state.sourceImg.naturalHeight;
  const sub=canvas(sw,sh),s=sub.getContext('2d');s.drawImage(state.sourceImg,0,0,sw,sh);
  const mask=canvas(sw,sh),m=mask.getContext('2d');m.filter=`blur(${state.feather}px)`;m.drawImage(state.maskCanvas,0,0,sw,sh);
  s.globalCompositeOperation='destination-in';s.drawImage(mask,0,0);s.globalCompositeOperation='source-over';
  const r=containRect(sw,sh,targetW,targetH,state.scale,state.x,state.y);return {canvas:sub,rect:r};
}
function drawBefore(ctx,w,h){ctx.clearRect(0,0,w,h);const r=coverRect(state.sourceImg.naturalWidth,state.sourceImg.naturalHeight,w,h);ctx.drawImage(state.sourceImg,...r)}
function renderInto(ctx,w,h){
  ctx.clearRect(0,0,w,h);
  if(state.mode==='remove'){
    const img=state.removedResult||state.sourceImg;const iw=img.width||img.naturalWidth,ih=img.height||img.naturalHeight;const r=coverRect(iw,ih,w,h);ctx.save();ctx.filter=`brightness(${state.brightness}%) saturate(${state.saturation}%) contrast(${state.clarity}%)`;ctx.drawImage(img,...r);ctx.restore();return;
  }
  drawBackground(ctx,w,h);
  const sub=makeSubjectComposite(w,h),r=sub.rect;
  if(state.shadow>0){ctx.save();ctx.globalAlpha=(state.shadow/100)*.44;ctx.filter=`blur(${Math.max(5,Math.min(w,h)*.018)}px)`;ctx.drawImage(sub.canvas,r[0]+w*.012,r[1]+h*.025,r[2],r[3]);ctx.restore()}
  ctx.save();ctx.filter=`brightness(${state.brightness}%) saturate(${state.saturation}%) contrast(${state.clarity}%)`;ctx.drawImage(sub.canvas,...r);ctx.restore();
}
function render(){
  if(!state.sourceImg)return;cancelAnimationFrame(pendingRender);pendingRender=requestAnimationFrame(()=>{
    const [w,h]=outputDims();[els.out,els.before,els.overlay,els.draw].forEach(c=>{c.width=w;c.height=h});
    renderInto(outCtx,w,h);drawBefore(beforeCtx,w,h);els.before.style.clipPath=state.compareOn?`inset(0 ${100-state.compare}% 0 0)`:'inset(0 100% 0 0)';els.compareLine.style.display=state.compareOn?'block':'none';els.compareLine.style.left=state.compare+'%';
    els.stage.style.transform=`scale(${state.previewZoom})`;drawMaskOverlay();
  })
}
function drawMaskOverlay(){
  if(!state.sourceImg)return;const w=els.overlay.width,h=els.overlay.height;overlayCtx.clearRect(0,0,w,h);drawCtx.clearRect(0,0,w,h);
  if(state.mode==='remove'){
    overlayCtx.save();overlayCtx.globalAlpha=.36;const tmp=canvas(w,h),t=tmp.getContext('2d');const r=coverRect(state.removeMaskCanvas.width,state.removeMaskCanvas.height,w,h);t.drawImage(state.removeMaskCanvas,...r);t.globalCompositeOperation='source-in';t.fillStyle='#ed1c24';t.fillRect(0,0,w,h);overlayCtx.drawImage(tmp,0,0);overlayCtx.restore();
  }
}
function syncControls(){
  $$('.mode-card').forEach(b=>b.classList.toggle('active',b.dataset.mode===state.mode));$$('.preset').forEach(b=>b.classList.toggle('active',b.dataset.preset===state.preset));$$('.ratio').forEach(b=>b.classList.toggle('active',b.dataset.ratio===state.ratio));
  $('#backgroundSection').style.display=state.mode==='keep'?'block':'none';$('#removeTools').style.display=state.mode==='remove'?'block':'none';['shadowRow','scaleRow','xRow','yRow'].forEach(id=>$('#'+id).style.display=state.mode==='keep'?'grid':'none');
  els.badge.textContent=state.mode==='keep'?'KEEP BIKE':'REMOVE BIKE';
  const map=[['feather',state.feather],['shadow',state.shadow],['subjectScale',Math.round(state.scale*100)],['subjectX',Math.round(state.x*100)],['subjectY',Math.round(state.y*100)],['bgBlur',state.bgBlur],['brightness',state.brightness],['saturation',state.saturation],['clarity',state.clarity],['previewZoom',Math.round(state.previewZoom*100)]];map.forEach(([id,v])=>$('#'+id).value=v);
}

async function autoCutout(automatic=false){
  if(!state.sourceFile)return;
  showProcessing(automatic?'Isolating your bike…':'Re-detecting your bike…');updateProgress(8);setModelStatus('working','Loading cutout AI…');
  const run=async(device)=>{
    const mod=await import('https://esm.sh/@imgly/background-removal@1.7.0?bundle&target=es2022');
    const removeBackground=mod.removeBackground||mod.default;
    if(typeof removeBackground!=='function')throw new Error('Background removal module did not load');
    updateProgress(18);
    return removeBackground(state.sourceFile,{
      model:'isnet_quint8',
      device,
      proxyToWorker:false,
      progress:(key,current,total)=>{if(total>0)updateProgress(18+(current/total)*70)},
      output:{format:'image/png',quality:1,type:'foreground'}
    });
  };
  try{
    let blob;
    try{blob=await run(navigator.gpu?'gpu':'cpu')}catch(first){console.warn('Primary cutout path failed, retrying CPU',first);setModelStatus('working','Retrying in compatibility mode…');blob=await run('cpu')}
    updateProgress(91);
    const url=URL.createObjectURL(blob),cut=await imgFromUrl(url);const [mw,mh]=[state.maskCanvas.width,state.maskCanvas.height];const c=canvas(mw,mh),cx=c.getContext('2d',{willReadFrequently:true});cx.drawImage(cut,0,0,mw,mh);const id=cx.getImageData(0,0,mw,mh);const m=state.maskCanvas.getContext('2d');const md=m.createImageData(mw,mh);const r=state.removeMaskCanvas.getContext('2d');const rd=r.createImageData(mw,mh);
    for(let i=0;i<id.data.length;i+=4){const a=id.data[i+3];md.data[i]=md.data[i+1]=md.data[i+2]=255;md.data[i+3]=a;rd.data[i]=rd.data[i+1]=rd.data[i+2]=a;rd.data[i+3]=255}
    m.putImageData(md,0,0);r.putImageData(rd,0,0);state.cutoutReady=true;state.modelLoaded=true;URL.revokeObjectURL(url);updateProgress(100);render();setModelStatus('ready','Bike cutout ready');toast('Bike isolated');
  }catch(err){console.error(err);setModelStatus('error','Automatic cutout unavailable');toast('Automatic cutout failed — use the refine brush')}
  finally{setTimeout(hideProcessing,220)}
}
function clearMask(){if(!state.sourceImg)return;initMasks();state.cutoutReady=false;state.removedResult=null;render();toast('Mask reset')}
function canvasPoint(ev){const rect=els.draw.getBoundingClientRect();return {x:(ev.clientX-rect.left)*(els.draw.width/rect.width),y:(ev.clientY-rect.top)*(els.draw.height/rect.height)}}
function outputToMask(pt,mask){const w=els.draw.width,h=els.draw.height;const r=state.mode==='keep'?containRect(mask.width,mask.height,w,h,state.scale,state.x,state.y):coverRect(mask.width,mask.height,w,h);return {x:(pt.x-r[0])*mask.width/r[2],y:(pt.y-r[1])*mask.height/r[3],scale:mask.width/r[2]}}
function paintMask(ev){if(!brushing)return;const p=canvasPoint(ev);const mask=state.mode==='remove'?state.removeMaskCanvas:state.maskCanvas;const mp=outputToMask(p,mask);if(mp.x<0||mp.y<0||mp.x>mask.width||mp.y>mask.height){lastPt=null;return}const ctx=mask.getContext('2d');ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=state.brushSize*mp.scale;ctx.strokeStyle=state.mode==='remove'?'#fff':(state.brushMode==='erase'?'rgba(0,0,0,0)':'#fff');ctx.globalCompositeOperation=(state.mode==='keep'&&state.brushMode==='erase')?'destination-out':'source-over';ctx.beginPath();if(lastPt){const lp=outputToMask(lastPt,mask);ctx.moveTo(lp.x,lp.y)}else ctx.moveTo(mp.x,mp.y);ctx.lineTo(mp.x,mp.y);ctx.stroke();ctx.globalCompositeOperation='source-over';lastPt=p;render()}
function pointerDown(ev){if(!state.sourceImg)return;ev.preventDefault();brushing=true;lastPt=null;els.draw.setPointerCapture?.(ev.pointerId);paintMask(ev)}
function pointerUp(ev){if(!brushing)return;brushing=false;lastPt=null;els.draw.releasePointerCapture?.(ev.pointerId);render()}

async function localFill(){
  if(!state.sourceImg)return;showProcessing('Rebuilding the masked area locally…');await new Promise(r=>setTimeout(r,30));
  try{
    const iw=state.sourceImg.naturalWidth,ih=state.sourceImg.naturalHeight;const max=1500,s=Math.min(1,max/Math.max(iw,ih));const w=Math.round(iw*s),h=Math.round(ih*s);const c=canvas(w,h),ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(state.sourceImg,0,0,w,h);const img=ctx.getImageData(0,0,w,h);const mc=canvas(w,h),mx=mc.getContext('2d');mx.drawImage(state.removeMaskCanvas,0,0,w,h);const mask=mx.getImageData(0,0,w,h).data;const status=new Uint8Array(w*h);let count=0;for(let i=0,p=0;i<mask.length;i+=4,p++){if(mask[i]>40){status[p]=1;count++}}
    if(!count){toast('Brush over the bike first');return}
    const q=new Int32Array(count);let head=0,tail=0;const queued=new Uint8Array(w*h);const hasKnown=n=>{const x=n%w,y=(n/w)|0;return (x>0&&status[n-1]===0)||(x<w-1&&status[n+1]===0)||(y>0&&status[n-w]===0)||(y<h-1&&status[n+w]===0)};
    for(let n=0;n<status.length;n++)if(status[n]===1&&hasKnown(n)){q[tail++]=n;queued[n]=1}
    const pix=img.data;const neigh=[-1,1,-w,w];let processed=0;
    while(head<tail){const n=q[head++],x=n%w,y=(n/w)|0;let rr=0,gg=0,bb=0,aa=0,k=0;for(const d of neigh){const m=n+d;if((d===-1&&x===0)||(d===1&&x===w-1)||(d===-w&&y===0)||(d===w&&y===h-1))continue;if(status[m]===0){const j=m*4;rr+=pix[j];gg+=pix[j+1];bb+=pix[j+2];aa+=pix[j+3];k++}}if(!k)continue;const j=n*4;pix[j]=rr/k;pix[j+1]=gg/k;pix[j+2]=bb/k;pix[j+3]=aa/k;status[n]=0;processed++;if(processed%18000===0){updateProgress(12+processed/count*74);await new Promise(r=>setTimeout(r,0))}for(const d of neigh){const m=n+d;if(m<0||m>=status.length)continue;if(status[m]===1&&!queued[m]&&hasKnown(m)){queued[m]=1;q[tail++]=m}}}
    ctx.putImageData(img,0,0);const blur=canvas(w,h),bx=blur.getContext('2d');bx.filter='blur(3px)';bx.drawImage(c,0,0);const result=canvas(w,h),rx=result.getContext('2d');rx.drawImage(state.sourceImg,0,0,w,h);rx.save();rx.drawImage(blur,0,0);rx.globalCompositeOperation='destination-in';rx.drawImage(mc,0,0);rx.restore();rx.globalCompositeOperation='destination-over';rx.drawImage(state.sourceImg,0,0,w,h);state.removedResult=result;updateProgress(100);render();toast('Background rebuilt locally')
  }catch(e){console.error(e);toast('Local fill failed — try a smaller mask')}
  finally{setTimeout(hideProcessing,180)}
}
function autoEnhance(){snapshot();state.brightness=104;state.saturation=108;state.clarity=107;syncControls();render();toast('Background enhanced')}
function exportCanvas(transparent=false){if(!state.sourceImg)return null;const maxSide=Math.min(4096,Math.max(state.sourceImg.naturalWidth,state.sourceImg.naturalHeight));const [w,h]=outputDims(maxSide);const c=canvas(w,h),ctx=c.getContext('2d');if(transparent){const sub=makeSubjectComposite(w,h);ctx.drawImage(sub.canvas,...sub.rect)}else renderInto(ctx,w,h);return c}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1200)}
async function exportDownload(type,transparent=false){const c=exportCanvas(transparent);if(!c)return;const mime=type==='jpg'?'image/jpeg':'image/png';const blob=await new Promise(r=>c.toBlob(r,mime,type==='jpg'?.94:1));if(!blob){toast('Export failed');return}downloadBlob(blob,`amp-studio-${transparent?'cutout':'edit'}.${type==='jpg'?'jpg':'png'}`);toast('Exported')}
async function copyPng(){try{const c=exportCanvas(false),blob=await new Promise(r=>c.toBlob(r,'image/png'));if(!blob)throw new Error('No image');await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);toast('PNG copied')}catch{toast('Copy is not supported here')}}
function openExport(){$('#exportSheet').classList.add('active')}
function closeExport(){$('#exportSheet').classList.remove('active')}

els.input.addEventListener('change',e=>loadSource(e.target.files[0]));
els.bgInput.addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;if(state.bgUrl)URL.revokeObjectURL(state.bgUrl);snapshot();state.bgUrl=URL.createObjectURL(f);state.bgImg=await imgFromUrl(state.bgUrl);render();toast('Background loaded')});
['dragenter','dragover'].forEach(ev=>els.drop.addEventListener(ev,e=>{e.preventDefault();els.drop.classList.add('drag')}));
['dragleave','drop'].forEach(ev=>els.drop.addEventListener(ev,e=>{e.preventDefault();els.drop.classList.remove('drag')}));
els.drop.addEventListener('drop',e=>loadSource(e.dataTransfer.files[0]));
$$('.mode-card').forEach(b=>b.addEventListener('click',()=>{snapshot();state.mode=b.dataset.mode;state.brushMode=state.mode==='remove'?'remove':'erase';syncControls();render()}));
$$('.preset').forEach(b=>b.addEventListener('click',()=>{snapshot();state.preset=b.dataset.preset;state.bgImg=null;syncControls();render()}));
$$('.ratio').forEach(b=>b.addEventListener('click',()=>{snapshot();state.ratio=b.dataset.ratio;syncControls();render()}));
$('#autoCutoutBtn').onclick=()=>autoCutout(false);$('#clearMaskBtn').onclick=clearMask;$('#localFillBtn').onclick=localFill;$('#autoEnhanceBtn').onclick=autoEnhance;
$('#eraseBrush').onclick=()=>{state.brushMode='erase';$('#eraseBrush').classList.add('active');$('#restoreBrush').classList.remove('active')};
$('#restoreBrush').onclick=()=>{state.brushMode='restore';$('#restoreBrush').classList.add('active');$('#eraseBrush').classList.remove('active')};
els.draw.addEventListener('pointerdown',pointerDown);els.draw.addEventListener('pointermove',paintMask);els.draw.addEventListener('pointerup',pointerUp);els.draw.addEventListener('pointercancel',pointerUp);
const bind=(id,key,fmt=v=>v)=>{const el=$('#'+id);let captured=false;const capture=()=>{if(!captured){snapshot();captured=true}};el.addEventListener('pointerdown',capture);el.addEventListener('keydown',capture);el.addEventListener('input',e=>{state[key]=+e.target.value;if(key==='scale')state[key]/=100;if(key==='x'||key==='y')state[key]/=100;if(key==='previewZoom')state[key]/=100;const out=$('#'+id+'Out');if(out)out.value=fmt(e.target.value);render()});el.addEventListener('change',()=>{captured=false})};
bind('feather','feather',v=>v+'px');bind('shadow','shadow',v=>v+'%');bind('subjectScale','scale',v=>v+'%');bind('subjectX','x');bind('subjectY','y');bind('bgBlur','bgBlur',v=>v+'px');bind('brightness','brightness',v=>v+'%');bind('saturation','saturation',v=>v+'%');bind('clarity','clarity',v=>v+'%');bind('previewZoom','previewZoom',v=>v+'%');
$('#brushSize').addEventListener('input',e=>{state.brushSize=+e.target.value;$('#brushOut').value=e.target.value});
$('#compareSlider').addEventListener('input',e=>{state.compare=+e.target.value;$('#compareOut').value=e.target.value+'%';render()});
$('#compareToggle').onclick=()=>{state.compareOn=!state.compareOn;render()};
$('#fitBtn').onclick=()=>{state.previewZoom=1;$('#previewZoom').value=100;$('#previewZoomOut').value='100%';render()};
$('#undoBtn').onclick=undo;$('#redoBtn').onclick=redo;
$('#newPhotoBtn').onclick=()=>{els.input.value='';els.uploadCard.style.display='block';els.editor.classList.remove('active');$('#bottomActions').classList.remove('active');els.input.click()};
$('#exportBtn').onclick=$('#bottomExport').onclick=openExport;
$('#transparentBtn').onclick=$('#bottomTransparent').onclick=()=>exportDownload('png',true);
$('#closeSheet').onclick=closeExport;$('#exportSheet').addEventListener('click',e=>{if(e.target.id==='exportSheet')closeExport()});
$('#downloadPng').onclick=()=>exportDownload('png');$('#downloadJpg').onclick=()=>exportDownload('jpg');$('#downloadTransparent').onclick=()=>exportDownload('png',true);$('#copyPng').onclick=copyPng;
syncControls();setModelStatus('',navigator.gpu?'WebGPU available':'Compatibility mode');
