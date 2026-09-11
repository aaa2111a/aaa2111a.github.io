/* TYB paper desk and selected acrylics. Local WebGL, actual mat transform, on-demand rendering. */
(function(){
'use strict';
const VERTEX_SOURCE = `
attribute vec2 aPosition;
void main(){gl_Position=vec4(aPosition,0.0,1.0);}
`;
const FRAGMENT_SOURCE = `
precision highp float;
uniform vec2 uResolution;
uniform vec2 uTilt;
uniform vec2 uCenter;
uniform float uScale;
uniform float uLift;
uniform float uPaperOnly;
uniform vec2 uViewport;
uniform float uScroll;
uniform float uRotation;
uniform vec2 uTile;
uniform sampler2D uUnder;
uniform sampler2D uArt;
uniform sampler2D uDistance;
const float H=0.047;
vec3 toLocal(vec3 p){
  float c=cos(uTilt.y),s=sin(uTilt.y);p=vec3(c*p.x-s*p.z,p.y,s*p.x+c*p.z);
  c=cos(uTilt.x);s=sin(uTilt.x);p=vec3(p.x,c*p.y+s*p.z,-s*p.y+c*p.z);
  c=cos(uRotation);s=sin(uRotation);return vec3(c*p.x+s*p.y,-s*p.x+c*p.y,p.z);
}
vec3 toWorld(vec3 p){
  float c=cos(uRotation),s=sin(uRotation);p=vec3(c*p.x-s*p.y,s*p.x+c*p.y,p.z);
  c=cos(uTilt.x);s=sin(uTilt.x);p=vec3(p.x,c*p.y-s*p.z,s*p.y+c*p.z);
  c=cos(uTilt.y);s=sin(uTilt.y);return vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);
}
vec2 imageUV(vec2 p){return vec2(p.x*0.5+0.5,0.5-p.y*0.5);}
vec2 atlasUV(vec2 uv){return (uTile+clamp(uv,vec2(0.0009765625),vec2(0.9990234375)))*0.25;}
float outline(vec2 p){
  vec2 uv=imageUV(p);
  float field=(dot(texture2D(uDistance,atlasUV(uv)).rg,vec2(65280.0,255.0))/65535.0-0.5)*4.0;
  return field+length(max(abs(p)-1.0,0.0))-0.044;
}
float solid(vec3 p){
  vec2 d=vec2(outline(p.xy)+0.014,abs(p.z)-(H-0.014));
  return min(max(d.x,d.y),0.0)+length(max(d,0.0))-0.014;
}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float grainNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);}
vec3 background(vec2 p){
  vec2 uv=(p+uCenter)/vec2(uResolution.x/uResolution.y,1.0)/uScale+0.5;
  return texture2D(uUnder,clamp(uv,vec2(0.0),vec2(1.0))).rgb;
}
vec3 floorColor(vec2 q){
  vec3 center=vec3(0,0,uLift);
  // Full-size footprint keeps the contact shadow visible around the acrylic.
  vec2 shadowQ=q;
  vec3 local=toLocal(vec3(shadowQ-vec2(uLift*.55,-uLift*.65),0)-center);
  float d=outline(local.xy);
  float softness=.022+uLift*.22;
  float shadow=(1.0-smoothstep(-.02,softness*3.0,d))*.25;
  vec3 nearLocal=toLocal(vec3(shadowQ,0)-center);
  shadow+=exp(-max(outline(nearLocal.xy),0.0)/.028)*.10*exp(-uLift*4.0);
  return background(q)*(1.0-shadow*0.5);
}
void main(){
  if(uPaperOnly>0.5){
    // Wave Filler Lab 03 / Cobalto: cream lineart on TYB blue, crisp at every DPR.
    // Evaluate in the same scrolling plane as the cutting mat, with no tile seam.
    // Both axes use viewport height: circular arcs stay circular at any aspect ratio.
    vec2 paper=vec2((gl_FragCoord.x/uResolution.x-.5)*uViewport.x/uViewport.y*1080.0+960.0,
      (1.0-gl_FragCoord.y/uResolution.y+uScroll/uViewport.y)*1080.0);
    float aa=max(1080.0/uResolution.y,(uViewport.x/uViewport.y)*1080.0/uResolution.x)*.65;
    // Staggered overlapping fans: the lower row occludes the earlier row's rings.
    // Include the fan's interior as well as its stroke, avoiding crossed linework.
    float ink=0.0;
    float firstRow=floor(paper.y/35.0)-1.0;
    for(int j=0;j<4;j++){
      float row=firstRow+float(j);
      float dx=mod(paper.x-mod(row,2.0)*67.0+67.0,134.0)-67.0;
      float radius=length(vec2(dx,paper.y-row*35.0));
      float lineDistance=min(min(abs(radius-14.5),abs(radius-32.0)),min(abs(radius-49.5),abs(radius-67.0)));
      float stroke=1.0-smoothstep(max(0.0,.75-aa),.75+aa,lineDistance);
      float cover=1.0-smoothstep(67.0+.75-aa,67.0+.75+aa,radius);
      ink=mix(ink,stroke,cover);
    }
    vec3 paperColor=mix(vec3(20.0,81.0,173.0)/255.0,vec3(255.0,253.0,245.0)/255.0,ink);
    gl_FragColor=vec4(paperColor,1.0);return;
  }
  vec2 screen=(gl_FragCoord.xy/uResolution-0.5)*vec2(uResolution.x/uResolution.y,1.0)*uScale;
  screen-=uCenter;
  vec3 origin=vec3(0,0,4.5), direction=normalize(vec3(screen,-4.5));
  vec2 floorPoint=screen;
  vec3 base=floorColor(floorPoint);
  // The small acrylic is the only expensive region; the rest is the flat desk.
  if(abs(screen.x)>1.32||abs(screen.y)>1.12){gl_FragColor=vec4(base,1);return;}
  vec3 ro=toLocal(origin-vec3(0,0,uLift));
  vec3 rd=toLocal(direction);
  float t=3.9;bool hit=false;vec3 p=vec3(0);
  for(int i=0;i<80;i++){
    p=ro+rd*t;float d=solid(p);
    if(d<0.0007){hit=true;break;}
    t+=max(d*.78,0.0004);if(t>5.7)break;
  }
  if(!hit){gl_FragColor=vec4(base,1);return;}
  float e=.003;
  vec3 n=normalize(vec3(solid(p+vec3(e,0,0))-solid(p-vec3(e,0,0)),solid(p+vec3(0,e,0))-solid(p-vec3(0,e,0)),solid(p+vec3(0,0,e))-solid(p-vec3(0,0,e))));
  vec3 nw=toWorld(n), view=-direction;
  // Refract through the clear cover to the shallow print layer.
  vec3 transmitted=refract(rd,n,1.0/1.49);
  float printTravel=(H-.015-p.z)/min(transmitted.z,-.001);
  vec2 printPoint=(p+transmitted*max(printTravel,0.0)).xy;
  vec4 ink=texture2D(uArt,atlasUV(imageUV(printPoint)));
  ink.a*=smoothstep(.2,.85,abs(n.z));
  vec3 world=toWorld(p)+vec3(0,0,uLift);
  vec3 transmittedWorld=toWorld(transmitted);
  float exitTravel=-world.z/min(transmittedWorld.z,-.06);
  vec2 throughPoint=world.xy+transmittedWorld.xy*max(exitTravel,0.0);
  vec3 clear=floorColor(throughPoint)*vec3(.975,.988,1.0);
  vec3 color=mix(clear,ink.rgb*.985,ink.a);
  float fresnel=.035+.965*pow(1.0-max(dot(nw,view),0.0),5.0);
  vec3 light=normalize(vec3(-.55,.7,1.6));
  vec3 halfVector=normalize(light+view);
  float spec=pow(max(dot(nw,halfVector),0.0),90.0);
  vec3 reflected=reflect(direction,nw);
  vec2 window=reflected.xy/max(reflected.z,.1);
  float softWindow=(1.0-smoothstep(.18,.40,abs(window.x+.40)))*(1.0-smoothstep(.42,.80,abs(window.y-.38)));
  float windowStrip=(1.0-smoothstep(.025,.11,abs(window.x+window.y*.35+.10)))*(1.0-smoothstep(.35,.75,abs(window.y)));
  color=mix(color,vec3(.76,.87,.94),fresnel*.67);
  color+=vec3(1.0,.97,.90)*(spec*.30+softWindow*(.085+.16*fresnel)+windowStrip*.085);
  // Polished outer bevel and a second bottom rim, produced from surface normals.
  color+=vec3(.76,.86,.95)*pow(1.0-abs(n.z),2.0)*(.09+.21*max(dot(nw,light),0.0));
  float contour=outline(p.xy);
  vec2 edgeNormal=normalize(vec2(outline(p.xy+vec2(e,0))-outline(p.xy-vec2(e,0)),outline(p.xy+vec2(0,e))-outline(p.xy-vec2(0,e)))+vec2(.00001));
  float rimLight=.58+.42*max(dot(edgeNormal,normalize(vec2(-.6,.8))),0.0);
  float rim=1.0-smoothstep(.001,.006,abs(contour+.013));
  float innerRim=1.0-smoothstep(.001,.004,abs(contour+.029));
  color=mix(color,vec3(.87,.93,.97),rim*.63*rimLight);
  color=mix(color,vec3(.36,.45,.51),innerRim*.20);
  gl_FragColor=vec4(clamp(color,0.0,1.0),1.0);
}
`;

  const root=document.documentElement,frameElement=document.querySelector('.mobile-frame'),track=document.querySelector('.track');
  if(!frameElement||window.TYB_ACRYLIC)return;
  const desktop=window.matchMedia('(min-width: 768px)'),reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const pages=window.TYB_ACRYLIC_PAGES||[],MAX_PIXELS=8294400;
  const rows=[.015,.145,.29,.43,.56,.705,.85,.98];
  const lanes=[.015,.113,.036,.124,.006,.098,.025,.122];
  const rotations=[-18,14,-12,21,-25,9,17,-8];
  const items=pages.flatMap(page=>page.items.map(item=>({...item,angles:[0,0],velocity:[0,0],target:[0,0],
    hitBytes:Uint8Array.from(item.hit.match(/../g).map(v=>parseInt(v,16)))})));
  let canvas=null,gl=null,program=null,buffer=null,under=null,atlas=[],locations={},images=[];
  let frame=0,last=0,lost=false,failed=false,destroyed=false,hidden=false,ready=false,loading=false,dirty=true;
  let pointer=null,hovered=null,layout=[],bounds=null,limits=null,oldOffset=root.style.getPropertyValue('--page-offset'),fallbackUntil=0;
  const listeners=[];
  function listen(target,name,fn){target.addEventListener(name,fn);listeners.push(()=>target.removeEventListener(name,fn));}
  function mediaListen(query,fn){if(query.addEventListener){query.addEventListener('change',fn);listeners.push(()=>query.removeEventListener('change',fn));}else{query.addListener(fn);listeners.push(()=>query.removeListener(fn));}}
  function stop(){if(frame)cancelAnimationFrame(frame);frame=0;last=0;}
  function schedule(){if(!frame&&!destroyed&&!failed&&!lost&&!hidden&&!document.hidden&&desktop.matches)frame=requestAnimationFrame(draw);}
  function release(){if(gl&&!lost){atlas.flat().forEach(t=>gl.deleteTexture(t));if(under)gl.deleteTexture(under);if(buffer)gl.deleteBuffer(buffer);if(program)gl.deleteProgram(program);}atlas=[];under=buffer=program=null;}
  function fail(error){failed=true;stop();if(canvas)canvas.classList.remove('is-ready');release();console.warn('TYB acrylic: paper fallback.',error.message);}
  function shader(type,source){const s=gl.createShader(type);if(!s)throw new Error('Shader allocation failed');gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const e=gl.getShaderInfoLog(s);gl.deleteShader(s);throw new Error(e);}return s;}
  function texture(unit,image){
    const t=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    if(image){gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);}
    return t;
  }
  function build(){
    let a,b;
    try{
      a=shader(gl.VERTEX_SHADER,VERTEX_SOURCE);b=shader(gl.FRAGMENT_SHADER,FRAGMENT_SOURCE);
      program=gl.createProgram();gl.attachShader(program,a);gl.attachShader(program,b);gl.bindAttribLocation(program,0,'aPosition');gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
      for(const name of ['uResolution','uViewport','uScroll','uPaperOnly','uTilt','uCenter','uScale','uLift','uRotation','uTile','uArt','uDistance','uUnder'])locations[name]=gl.getUniformLocation(program,name);
      atlas=images.map(pair=>pair.map((im,i)=>texture(i,im)));under=texture(2);
      gl.uniform1i(locations.uArt,0);gl.uniform1i(locations.uDistance,1);gl.uniform1i(locations.uUnder,2);
      gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);dirty=true;
    }finally{if(a)gl.deleteShader(a);if(b)gl.deleteShader(b);}
  }
  function image(src){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('Atlas decode failed'));im.src=src;});}
  function initialize(){
    if(ready||loading)return;
    loading=true;
    if(!canvas){
      canvas=document.createElement('canvas');canvas.className='tyb-acrylic-canvas';canvas.setAttribute('aria-hidden','true');document.body.prepend(canvas);
      listen(canvas,'webglcontextlost',event=>{event.preventDefault();lost=true;stop();canvas.classList.remove('is-ready');atlas=[];under=program=buffer=null;});
      listen(canvas,'webglcontextrestored',()=>{if(destroyed)return;lost=false;try{build();schedule();}catch(e){fail(e);}});
    }
    Promise.all(pages.map(page=>Promise.all([image(page.art),image(page.distance)]))).then(result=>{
      if(destroyed)return;images=result;
      gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false,powerPreference:'low-power'});
      if(!gl)throw new Error('WebGL unavailable');
      const maxTexture=gl.getParameter(gl.MAX_TEXTURE_SIZE),viewport=gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      if(maxTexture<2048)throw new Error('2048px atlases unavailable');
      limits=[Math.min(maxTexture,viewport[0]),Math.min(maxTexture,viewport[1])];
      build();ready=true;loading=false;schedule();
    }).catch(fail);
  }
  function cameraOffset(){
    if(!track)return 0;
    const value=getComputedStyle(track).transform;if(!value||value==='none')return 0;
    const values=value.slice(value.indexOf('(')+1,-1).split(',').map(Number);
    const y=value.startsWith('matrix3d(')?values[13]:values[5];return Number.isFinite(y)?-y:0;
  }
  function moving(now){if(!track)return false;if(track.getAnimations)return track.getAnimations().some(a=>a.transitionProperty==='transform'&&(a.playState==='running'||a.pending));return now<fallbackUntil;}
  function motionChanged(){
    const value=getComputedStyle(root).getPropertyValue('--transition-duration').trim();
    const duration=parseFloat(value)*(value.endsWith('ms')?1:1000);fallbackUntil=performance.now()+(Number.isFinite(duration)?duration:720)+100;
    rest();schedule();
  }
  function positions(offset){
    const width=root.clientWidth||innerWidth,height=root.clientHeight||innerHeight,rect=frameElement.getBoundingClientRect();
    const side=(width-rect.width)/2,ppw=Math.max(1,Math.min(height/7,side/1.85));
    bounds={width,height,rect,ppw};
    return items.map(item=>{
      const placement=item.placement;
      const row=item.slot%8,right=placement?placement.right:item.slot>=8,variation=(item.page-1)*.008;
      let x=(placement?placement.x:lanes[row]+variation)*width;
      // Keep the innermost boundary clear of the cutting mat at narrow desktop sizes.
      x=Math.min(x,Math.max(0,side-ppw*(placement?.minWidth?1.05:1.3)-14));
      if(right)x=width-x;
      const y=rect.top+(placement?placement.section+placement.y:item.page+rows[row])*rect.height-offset;
      const rotation=(placement?placement.rotation:rotations[(row+item.page)%8]*(right?-1:1))*Math.PI/180;
      const enabled=!placement?.minWidth||width>=placement.minWidth;
      return {item,x,y,rotation,ppw,visible:enabled&&y+ppw*1.4>0&&y-ppw*1.4<height};
    });
  }
  function local(p,x,y,z){
    let c=Math.cos(y),s=Math.sin(y);p=[c*p[0]-s*p[2],p[1],s*p[0]+c*p[2]];
    c=Math.cos(x);s=Math.sin(x);p=[p[0],c*p[1]+s*p[2],-s*p[1]+c*p[2]];
    c=Math.cos(z);s=Math.sin(z);return [c*p[0]+s*p[1],-s*p[0]+c*p[1],p[2]];
  }
  function liftFor(entry){
    const [x,y]=entry.item.angles,c=Math.cos(entry.rotation),s=Math.sin(entry.rotation);let minimum=0;
    if(x===0&&y===0)return .051;
    const sy=Math.sin(y),sxy=Math.sin(x)*Math.cos(y);
    for(const p of entry.item.support){const px=c*p[0]-s*p[1],py=s*p[0]+c*p[1];minimum=Math.min(minimum,-sy*px+sxy*py);}
    return .047*Math.abs(Math.cos(x)*Math.cos(y))-minimum+.004;
  }
  function hit(entry,point){
    const [x,y]=entry.item.angles,ro=local([0,0,4.5-liftFor(entry)],x,y,entry.rotation);
    const rd=local([(point.x-entry.x)/entry.ppw,(entry.y-point.y)/entry.ppw,-4.5],x,y,entry.rotation);
    const t=(.047-ro[2])/rd[2],px=ro[0]+rd[0]*t,py=ro[1]+rd[1]*t;
    const ix=Math.floor((px*.5+.5)*128),iy=Math.floor((.5-py*.5)*128);
    if(ix<0||iy<0||ix>=128||iy>=128)return false;
    const index=iy*128+ix;return !!(entry.item.hitBytes[index>>3]&(1<<(index&7)));
  }
  function rest(){hovered=null;items.forEach(i=>{i.target[0]=i.target[1]=0;});}
  function selectHover(isMoving){
    rest();if(!pointer||reduced.matches||isMoving)return;
    const r=bounds.rect;if(pointer.x>=r.left&&pointer.x<=r.right&&pointer.y>=r.top&&pointer.y<=r.bottom)return;
    for(let i=layout.length-1;i>=0;i--){const e=layout[i];if(e.visible&&Math.abs(pointer.x-e.x)<e.ppw*1.35&&Math.abs(pointer.y-e.y)<e.ppw*1.35&&hit(e,pointer)){
      hovered=e.item;e.item.target=[Math.max(-.105,Math.min(.105,(pointer.y-e.y)/e.ppw*.105)),Math.max(-.105,Math.min(.105,(pointer.x-e.x)/e.ppw*.105))];break;
    }}
  }
  function draw(now){
    frame=0;if(destroyed||failed||lost||hidden||document.hidden||!desktop.matches)return;
    if(!ready){initialize();return;}
    try{
      const offset=cameraOffset(),inMotion=moving(now);layout=positions(offset);selectHover(inMotion);
      const dt=last?Math.min((now-last)/1000,.032):1/60;last=now;let active=inMotion;
      for(const item of items)for(let i=0;i<2;i++){
        if(reduced.matches){item.angles[i]=item.velocity[i]=item.target[i]=0;}
        else{item.velocity[i]+=(item.target[i]-item.angles[i])*105*dt;item.velocity[i]*=Math.exp(-14*dt);item.angles[i]+=item.velocity[i]*dt;}
        if(Math.abs(item.target[i]-item.angles[i])>.00004||Math.abs(item.velocity[i])>.0001)active=true;else{item.angles[i]=item.target[i];item.velocity[i]=0;}
      }
      const {width,height}=bounds;
      if(dirty){
        const density=Math.min(devicePixelRatio||1,2,Math.sqrt(MAX_PIXELS/(width*height)),limits[0]/width,limits[1]/height);
        canvas.width=Math.max(1,Math.floor(width*density));canvas.height=Math.max(1,Math.floor(height*density));
        gl.viewport(0,0,canvas.width,canvas.height);
        // The alpha:false drawing buffer is RGB. WebGL forbids copying it into RGBA.
        gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,under);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,canvas.width,canvas.height,0,gl.RGB,gl.UNSIGNED_BYTE,null);dirty=false;
      }
      gl.disable(gl.SCISSOR_TEST);gl.uniform2f(locations.uResolution,canvas.width,canvas.height);gl.uniform2f(locations.uViewport,width,height);gl.uniform1f(locations.uScroll,offset);gl.uniform1f(locations.uPaperOnly,1);gl.drawArrays(gl.TRIANGLES,0,3);
      gl.uniform1f(locations.uPaperOnly,0);gl.enable(gl.SCISSOR_TEST);
      const sx=canvas.width/width,sy=canvas.height/height;
      for(const e of layout){
        if(!e.visible)continue;
        const x=Math.max(0,Math.floor((e.x-e.ppw*1.4)*sx)),y=Math.max(0,Math.floor((height-e.y-e.ppw*1.4)*sy));
        const right=Math.min(canvas.width,Math.ceil((e.x+e.ppw*1.4)*sx)),top=Math.min(canvas.height,Math.ceil((height-e.y+e.ppw*1.4)*sy));
        if(right<=x||top<=y)continue;
        // Snapshot just this region before drawing; clear acrylic sees earlier pieces.
        gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,under);gl.copyTexSubImage2D(gl.TEXTURE_2D,0,x,y,x,y,right-x,top-y);
        gl.scissor(x,y,right-x,top-y);
        for(let i=0;i<2;i++){gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,atlas[e.item.page][i]);}
        gl.uniform2f(locations.uTile,e.item.slot%4,Math.floor(e.item.slot/4));gl.uniform2f(locations.uTilt,...e.item.angles);gl.uniform1f(locations.uRotation,e.rotation);gl.uniform1f(locations.uLift,liftFor(e));
        gl.uniform1f(locations.uScale,height/e.ppw);gl.uniform2f(locations.uCenter,(e.x-width*.5)/e.ppw,(height*.5-e.y)/e.ppw);gl.drawArrays(gl.TRIANGLES,0,3);
      }
      gl.disable(gl.SCISSOR_TEST);canvas.classList.add('is-ready');
      if(active)schedule();else last=0;
    }catch(e){fail(e);}
  }
  function resize(){dirty=true;if(!desktop.matches){stop();rest();if(canvas){canvas.width=canvas.height=1;canvas.classList.remove('is-ready');}}else schedule();}
  const observer=new MutationObserver(()=>{const offset=root.style.getPropertyValue('--page-offset');if(offset!==oldOffset){oldOffset=offset;motionChanged();}});
  observer.observe(root,{attributes:true,attributeFilter:['style']});
  if(track)for(const name of ['transitionrun','transitionend','transitioncancel'])listen(track,name,e=>{if(e.target===track&&e.propertyName==='transform'){if(name==='transitionrun')motionChanged();else{fallbackUntil=0;schedule();}}});
  listen(window,'pointermove',e=>{
    pointer={x:e.clientX,y:e.clientY};
    if(ready&&!hovered&&!layout.some(p=>p.visible&&Math.abs(pointer.x-p.x)<p.ppw*1.4&&Math.abs(pointer.y-p.y)<p.ppw*1.4)){pointer=null;return;}
    schedule();
  });
  listen(document,'pointerleave',()=>{pointer=null;rest();schedule();});
  listen(window,'blur',()=>{pointer=null;rest();schedule();});
  listen(window,'resize',resize);listen(document,'fullscreenchange',resize);
  listen(document,'visibilitychange',()=>{if(document.hidden){stop();pointer=null;rest();}else resize();});
  listen(window,'pagehide',()=>{hidden=true;stop();});listen(window,'pageshow',()=>{hidden=false;resize();});
  mediaListen(desktop,resize);mediaListen(reduced,()=>{rest();schedule();});
  function destroy(){destroyed=true;stop();observer.disconnect();listeners.forEach(remove=>remove());release();if(canvas)canvas.remove();delete window.TYB_ACRYLIC;}
  window.TYB_ACRYLIC=Object.freeze({refresh:resize,destroy});
  schedule();
})();
