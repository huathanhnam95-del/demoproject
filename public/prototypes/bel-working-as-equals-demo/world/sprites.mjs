export function shape(ctx,type,x,y,size=19,empty=false){
  ctx.save();ctx.translate(x,y);ctx.lineWidth=2;ctx.strokeStyle='#513923';ctx.fillStyle=empty?'#80512d':({triangle:'#ca6742',square:'#3689ac',circle:'#7c9960'}[type]);
  ctx.beginPath();if(type==='triangle'){ctx.moveTo(0,-size);ctx.lineTo(size,size/2);ctx.lineTo(-size,size/2);ctx.closePath();}else if(type==='square')ctx.rect(-size,-size,size*2,size*1.6);else ctx.ellipse(0,-size/5,size,size*.8,0,0,Math.PI*2);ctx.fill();ctx.stroke();
  if(!empty){ctx.strokeStyle='#ffffff55';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-size*.6,-size*.5);ctx.lineTo(size*.25,-size*.7);ctx.stroke();}ctx.restore();
}
export function ride(ctx,type,x,y,dir=1,phase=0){
  ctx.save();ctx.translate(Math.round(x),Math.round(y));ctx.scale(dir,1);
  const rect=(x,y,w,h,c)=>{ctx.fillStyle=c;ctx.fillRect(x,y,w,h);};
  ctx.fillStyle='#0003';ctx.beginPath();ctx.ellipse(0,3,32,5,0,0,7);ctx.fill();
  rect(-29,-6,56,5,'#172f36');rect(-25,-8,46,3,type==='scooter'?'#566b6e':'#d2aa65');
  for(const x of [-23,23]){ctx.fillStyle='#20292e';ctx.beginPath();ctx.arc(x,0,5,0,7);ctx.fill();rect(x-2,-2,3,3,'#a0aaac');}
  if(type==='scooter'){rect(18,-48,4,43,'#1c333f');rect(14,-49,13,4,'#121f29');rect(20,-43,2,32,'#819296');}
  else{rect(-27,-10,6,3,'#e3ba70');rect(21,-10,6,3,'#e3ba70');}ctx.restore();
}
// The approved cast supplies the live sprite artwork. Flood fill removes only
// connected floor around the dark outlined figure; original assets stay intact.
export function createSpriteAtlas(images){
  const specs={p0:['D',238,352,62,163],p1:['home',477,475,70,140],p2:['reception',888,469,67,132],p3:['reception',698,499,67,133]};
  const cache=new Map();
  return function spriteFor(profile){
    const key=profile.id+':'+JSON.stringify(profile.appearance);if(cache.has(key))return cache.get(key);
    const [art,x,y,w,h]=specs[profile.id],c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(images[art],x,y,w,h,0,0,w,h);
    const im=g.getImageData(0,0,w,h),d=im.data,seen=new Uint8Array(w*h),queue=[];
    const hatLimit=profile.id==='p3'?Math.floor(h*.18):0;
    const isFloor=j=>{const r=d[j],g=d[j+1],b=d[j+2];return r>125&&g>110&&b>70&&r>=g&&r-g<65&&g-b<80;};
    const add=i=>{if(i<0||i>=w*h||seen[i])return;if(Math.floor(i/w)<hatLimit)return;seen[i]=1;const j=i*4;if(isFloor(j)){queue.push(i);d[j+3]=0;}};
    for(let xx=0;xx<w;xx++){add(xx);add((h-1)*w+xx);}for(let yy=0;yy<h;yy++){add(yy*w);add(yy*w+w-1);}
    for(let k=0;k<queue.length;k++){const i=queue[k];if(i%w)add(i-1);if(i%w<w-1)add(i+1);add(i-w);add(i+w);}
    for(let yy=0;yy<hatLimit;yy++){for(let xx=0;xx<w;xx++){const j=(yy*w+xx)*4;if(!d[j+3])continue;if(isFloor(j))d[j+3]=0;else break;}for(let xx=w-1;xx>=0;xx--){const j=(yy*w+xx)*4;if(!d[j+3])continue;if(isFloor(j))d[j+3]=0;else break;}}
    const tint={teal:[36,143,137],cream:[224,216,193],amber:[180,111,41],red:[161,54,38]}[profile.appearance.shirt];
    if(tint)for(let yy=Math.floor(h*.37);yy<Math.floor(h*.72);yy++)for(let xx=0;xx<w;xx++){
      const j=(yy*w+xx)*4,r=d[j],gg=d[j+1],b=d[j+2];
      const cloth=profile.id==='p1'?gg>r*1.3&&gg>b*.85:profile.id==='p2'?r>170&&gg>170&&b>160:profile.id==='p3'?r>90&&gg>50&&gg<r*.8&&b<gg*.75:r>75&&r>gg*1.5&&r>b*1.5;
      if(d[j+3]&&cloth){const shade=Math.max(.35,Math.min(1.3,(r+gg+b)/350));d[j]=tint[0]*shade;d[j+1]=tint[1]*shade;d[j+2]=tint[2]*shade;}
    }
    g.putImageData(im,0,0);
    if(profile.id==='p0'){const f=document.createElement('canvas');f.width=w;f.height=h;const fc=f.getContext('2d');fc.translate(w,0);fc.scale(-1,1);fc.drawImage(c,0,0);g.clearRect(0,0,w,h);g.drawImage(f,0,0);}
    // The source cast includes baked glasses and a straw hat. When removed,
    // compose the uncovered head from the approved bare-headed cast member.
    // Accessories are then drawn from the actual selected appearance below.
    if((profile.id==='p1'&&!profile.appearance.glasses)||(profile.id==='p3'&&profile.appearance.hat!=='straw')){
      const bare=spriteFor({...profile,id:'p2',appearance:{shirt:'cream',hat:'none',glasses:false}});
      const head=Math.ceil(h*.36);g.clearRect(0,0,w,head);
      g.drawImage(bare,0,0,bare.width,Math.ceil(bare.height*.36),0,0,w,head);
    }
    cache.set(key,c);return c;
  };
}
export function avatar(ctx,p,profile,now,local=false,atlas=null){
  if(atlas){
    const sprite=atlas(profile),height=77,width=height*sprite.width/sprite.height,walking=p.pose==='walking'||p.pose==='carrying';
    const strideFreq=(Math.PI*2)/60,phase=(p.distance||0)*strideFreq;
    const isVertical=p.facing==='up'||p.facing==='down';
    const maxStride=isVertical?0.12:0.28;
    const strideAngle=walking?Math.sin(phase)*maxStride:0;
    const hipBob=walking?-Math.abs(Math.sin(phase))*1.5:0;
    const lift1=walking?Math.max(0,Math.cos(phase))*2.6:0;
    const lift2=walking?Math.max(0,-Math.cos(phase))*2.6:0;
    ctx.save();ctx.translate(Math.round(p.x),Math.round(p.y));
    const dir=(p.facingDir===-1||p.facingDir===1)?p.facingDir:(p.facing==='left'?-1:1);
    const shadowW=p.ride?32:(15+(walking?Math.abs(Math.sin(phase))*3:0));
    ctx.fillStyle='#48342044';ctx.beginPath();ctx.ellipse(0,2,shadowW,5,0,0,7);ctx.fill();
    if(local){ctx.strokeStyle='#efc775';ctx.lineWidth=1.5;ctx.beginPath();ctx.ellipse(0,3,p.ride?35:18,7,0,0,7);ctx.stroke();}
    if(p.ride)ride(ctx,p.ride,0,0,dir);
    ctx.scale(dir,1);const legs=Math.round(sprite.height*.73),top=height*.73;
    const overSrc=walking?10:0,overDst=overSrc*height/sprite.height;
    const torsoLean=walking&&!p.ride?(isVertical?0.015:0.04):0;
    const hipY=-height+top+hipBob;
    if(p.seat||p.ride){
      // Bend the thighs forward, lower legs to a grounded foot/board anchor.
      for(const [sx,off]of [[0,-5],[sprite.width/2,5]]){ctx.save();ctx.translate(off,-height+top-2);ctx.rotate(-.5);ctx.drawImage(sprite,sx,legs,sprite.width/2,sprite.height-legs,-width/4,0,width/2,height-top);ctx.restore();}
      if(p.ride==='scooter'){ctx.strokeStyle='#d8af7d';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(8,-47);ctx.lineTo(19,-46);ctx.stroke();}
    }else if(walking){
      // Grounded stance leg stays planted on the floor; swing leg lifts during forward swing
      ctx.save();ctx.translate(-width*0.22,hipY);ctx.rotate(strideAngle);
      ctx.drawImage(sprite,0,legs,sprite.width/2,sprite.height-legs,-width/4,-lift1,width/2,height-top);ctx.restore();
      ctx.save();ctx.translate(width*0.22,hipY);ctx.rotate(-strideAngle);
      ctx.drawImage(sprite,sprite.width/2,legs,sprite.width/2,sprite.height-legs,-width/4,-lift2,width/2,height-top);ctx.restore();
    }else{
      ctx.drawImage(sprite,0,legs,sprite.width/2,sprite.height-legs,-width/2,-height+top,width/2,height-top);
      ctx.drawImage(sprite,sprite.width/2,legs,sprite.width/2,sprite.height-legs,0,-height+top,width/2,height-top);
    }
    // Upper body and accessories lean and bob together
    ctx.save();
    ctx.translate(0,hipBob);
    if(torsoLean){ctx.translate(0,-height+top);ctx.rotate(torsoLean);ctx.translate(0,height-top);}
    ctx.drawImage(sprite,0,0,sprite.width,legs+overSrc,-width/2,-height-(p.ride?6:0),width,top+overDst);
    if(profile.appearance.hat==='cap'){ctx.fillStyle='#3b6972';ctx.fillRect(-10,-height-2,22,7);ctx.fillRect(8,-height+4,10,3);}
    if(profile.appearance.hat==='straw'&&profile.id!=='p3'){ctx.fillStyle='#dac190';ctx.fillRect(-9,-height-4,18,7);ctx.fillRect(-15,-height+2,31,4);}
    if(profile.appearance.glasses&&profile.id!=='p1'){ctx.strokeStyle='#183b3d';ctx.lineWidth=1.5;ctx.strokeRect(-7,-height+14,7,5);ctx.strokeRect(1,-height+14,7,5);ctx.fillStyle='#183b3d';ctx.fillRect(-1,-height+16,2,1);}
    if(p.carry?.startsWith('shape-'))shape(ctx,['triangle','square','circle'][Number(p.carry.split('-')[1])],9,-28,13);
    if(p.carry?.startsWith('plank-')){ctx.strokeStyle='#ddb07d';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(-12,-38);ctx.lineTo(-21,-27);ctx.moveTo(12,-38);ctx.lineTo(21,-27);ctx.stroke();}
    if(p.waveUntil>now){ctx.strokeStyle='#d4a474';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(14,-36);ctx.lineTo(24,-50-Math.sin(now/90)*5);ctx.stroke();}
    ctx.restore();
    ctx.restore();ctx.save();ctx.font='600 10px system-ui';ctx.textAlign='center';const name=profile.name+(p.waveUntil>now?' · Hi!':'');const n=ctx.measureText(name).width+12;const labelY=p.y-96-(Number(profile.id[1])%2)*14;ctx.fillStyle='#fff7e6ef';ctx.fillRect(p.x-n/2,labelY,n,15);ctx.fillStyle='#30433f';ctx.fillText(name,p.x,labelY+11);ctx.restore();return;
  }
  const riding=!!p.ride,side=p.facing==='left'||p.facing==='right',direction=(p.facingDir===-1||p.facingDir===1)?p.facingDir:(p.facing==='left'?-1:1);
  const strideFreq=(Math.PI*2)/60,phase=(p.distance||0)*strideFreq;
  const isVertical=p.facing==='up'||p.facing==='down';
  const walking=['walking','carrying'].includes(p.pose),seated=p.pose==='seated';
  ctx.save();ctx.translate(Math.round(p.x),Math.round(p.y));
  const shadowW=riding?32:(15+(walking?Math.abs(Math.sin(phase))*3:0));
  ctx.fillStyle='#34261940';ctx.beginPath();ctx.ellipse(0,2,shadowW,5,0,0,Math.PI*2);ctx.fill();
  if(local){ctx.strokeStyle='#e7b766';ctx.lineWidth=1.5;ctx.beginPath();ctx.ellipse(0,3,riding?35:18,7,0,0,7);ctx.stroke();}
  if(riding)ride(ctx,p.ride,0,0,direction,phase);
  ctx.scale(direction*1.35,1.35);if(riding)ctx.translate(-3,-6);
  const bob=walking?Math.abs(Math.sin(phase))*1.5:0;
  const rect=(x,y,w,h,c)=>{ctx.fillStyle=c;ctx.fillRect(Math.round(x),Math.round(y-bob),w,h);};
  const outline=(x,y,w,h,c)=>{rect(x-1,y-1,w+2,h+2,'#252623');rect(x,y,w,h,c);};
  const shirt={teal:'#268e8c',cream:'#eee4cb',amber:'#b77534',red:'#a94630',default:profile.gender==='male'?'#a94630':'#268e8c'}[profile.appearance.shirt]||'#268e8c';
  const skin='#deb17d',hair=profile.id==='p2'?'#8a4d21':'#38271d';
  const stride=walking?(isVertical?Math.sin(phase)*1.5:Math.sin(phase)*3.5):0;
  const lift1=walking?Math.max(0,-Math.cos(phase))*2.2:0;
  const lift2=walking?Math.max(0,Math.cos(phase))*2.2:0;
  if(seated){outline(-7,-16,9,5,'#285369');outline(1,-14,10,5,'#21465b');outline(7,-9,5,7,'#22455a');outline(-3,-11,5,7,'#316078');outline(7,-2,8,3,'#664324');outline(-3,-3,8,3,'#664324');}
  else if(riding){outline(-8,-19,7,9,'#285369');outline(-10,-10,6,7,'#316078');outline(1,-19,6,12,'#21465b');outline(-11,-4,9,3,'#78502c');outline(1,-4,9,3,'#78502c');}
  else{
    outline(-7-stride,-17+bob-lift1,6,14,'#2a5670');outline(1+stride,-17+bob-lift2,6,14,'#204255');
    outline(-8-stride,-3+bob-lift1,8,3,'#775230');outline(1+stride,-3+bob-lift2,8,3,'#775230');
  }
  outline(-8,-34,17,19,shirt);rect(-6,-32,4,13,'#ffffff18');rect(5,-29,3,12,'#0002');
  const waving=p.waveUntil>now;
  const carrying=!!p.carry;
  if(riding&&p.ride==='scooter'){outline(6,-32,4,8,shirt);outline(8,-28,11,4,skin);}
  else if(carrying){outline(-11,-31,4,13,shirt);outline(8,-31,4,13,shirt);outline(-10,-20,7,4,skin);outline(4,-20,7,4,skin);}
  else{outline(-12,-31,4,waving?6:13,shirt);outline(-13,waving?-40:-19+(walking?stride:0),4,7,skin);outline(9,-31,4,13,shirt);outline(9,-19-(walking?stride:0),4,6,skin);}
  outline(-7,-48,15,14,skin);rect(-9,-49,17,6,hair);rect(-10,-46,4,10,hair);rect(6,-46,3,4,hair);rect(-5,-51,10,3,hair);
  if(profile.gender==='female'){rect(-13,-44,5,15,hair);rect(-16,-39,5,10,hair);rect(-13,-45,4,3,'#55342c');}
  if(p.facing==='up'){rect(-8,-48,16,13,hair);rect(-6,-35,12,2,hair);}else{
    rect(side?4:-3,-40,2,2,'#292521');if(!side)rect(3,-40,2,2,'#292521');rect(6,-38,4,3,skin);rect(2,-35,3,1,'#a66b4a');
    if(profile.appearance.glasses){rect(-5,-42,5,4,'#1e3034');rect(2,-42,6,4,'#1e3034');rect(0,-41,2,1,'#1e3034');rect(-4,-41,3,2,'#93bbbd');rect(3,-41,3,2,'#93bbbd');}
  }
  if(profile.appearance.hat==='straw'){outline(-7,-54,14,5,'#d9bd83');outline(-11,-49,23,3,'#e7cb8d');rect(-7,-50,14,2,'#7b5a39');}
  if(profile.appearance.hat==='cap'){outline(-8,-51,17,5,'#608085');rect(8,-47,7,2,'#31505b');}
  if(carrying)shape(ctx,['triangle','square','circle'][Number(p.carry.split('-')[1])],0,-18,9);
  ctx.restore();
  ctx.save();ctx.font='600 10px system-ui';ctx.textAlign='center';const label=profile.name+(p.waveUntil>now?' · Hi!':'');const width=ctx.measureText(label).width+14;
  const lblY=p.y-(riding?86:81)-(Number(profile.id[1])%2)*14;ctx.fillStyle='#fff8e6ee';ctx.fillRect(p.x-width/2,lblY,width,15);ctx.fillStyle='#283c40';ctx.fillText(label,p.x,lblY+11);ctx.restore();
}
export function car(ctx,c){
  ctx.save();ctx.translate(c.x,c.y);ctx.scale(c.dir,1);ctx.fillStyle='#0004';ctx.fillRect(-c.w/2+3,-c.h/2+9,c.w,c.h);
  ctx.fillStyle='#202c31';for(const x of [-c.w/2+19,c.w/2-23])ctx.fillRect(x,-c.h/2-4,14,c.h+8);
  ctx.fillStyle=c.color;ctx.fillRect(-c.w/2,-c.h/2,c.w,c.h);ctx.fillStyle='#243f51';ctx.fillRect(-c.w/2+35,-c.h/2+5,c.w-68,c.h-10);
  ctx.fillStyle='#7598a8';ctx.fillRect(-c.w/2+38,-c.h/2+7,10,c.h-14);ctx.fillStyle='#f9de99';ctx.fillRect(c.w/2-4,-c.h/2+4,5,8);ctx.fillRect(c.w/2-4,c.h/2-12,5,8);ctx.restore();
}
