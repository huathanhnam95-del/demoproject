import {SCENES,SHAPES} from './scenes.mjs';
import {avatar,ride,shape,car,createSpriteAtlas} from './sprites.mjs';
import {carsAt,nearest} from './simulation.mjs';
import {prepareBridgeBackground,drawBridge,drawBridgeActors,prepareChoicesBackground,drawChoices,drawReversalActors,prepareCubeBackground,drawCubes,drawCubeActors} from './activity-renderer.mjs';
export async function createRenderer(canvas){
  const images=Object.fromEntries(await Promise.all(['home','street','reception','A','B','C','D','F','F-complete','I','J'].map(async key=>{const img=new Image();img.src=new URL(`../art/${key}.png`,import.meta.url).href;await img.decode();return [key,img];})));
  const backgrounds={},atlas=createSpriteAtlas(images);
  for(const scene of Object.values(SCENES)){
    if(backgrounds[scene.art])continue;
    const b=document.createElement('canvas');b.width=1000;b.height=480;const c=b.getContext('2d');const img=images[scene.art];
    c.drawImage(img,0,42,1672,802,0,0,1000,480);
    const original=document.createElement('canvas');original.width=1000;original.height=480;original.getContext('2d').drawImage(b,0,0);
    for(const r of scene.erase||[])c.drawImage(original,r.sampleX,r.y,20,r.h,r.x,r.y,r.w,r.h);
    if(scene.carpet){
      // Restore the screen/wall underneath the reference's presenter before
      // drawing the live cast; these samples exclude all baked characters.
      c.drawImage(original,500,100,25,34,558,100,26,34);
      c.drawImage(original,796,100,26,34,584,100,28,34);
      c.drawImage(original,325,134,22,46,558,134,54,46);
      c.drawImage(img,565,358,50,275,332,185,336,174);
      // Render six empty native sage seats; occupied poses belong to live actors.
      for(const s of scene.targets.filter(t=>t.type==='seat'))c.drawImage(img,791,419,85,77,s.x-25,s.y-39,51,46);
    }
    if(scene.emptyTriangle){
      // Assemble the obscured floor from a clean native timber tile. Reapply
      // static furnishings after the floor, so no baked reader/person survives.
      const tile=document.createElement('canvas');tile.width=120;tile.height=64;tile.getContext('2d').drawImage(original,347,300,120,64,0,0,120,64);
      c.fillStyle=c.createPattern(tile,'repeat');c.beginPath();c.moveTo(92,137);c.lineTo(843,137);c.lineTo(956,245);c.lineTo(970,375);c.lineTo(37,375);c.lineTo(68,253);c.lineTo(91,253);c.closePath();c.fill();
      for(const [x,y,w,h]of [[173,108,128,61],[173,169,102,73],[427,31,126,130],[653,79,129,123],[95,90,49,89],[338,67,48,82],[797,52,52,101]])c.drawImage(original,x,y,w,h,x,y,w,h);
      c.drawImage(original,181,147,17,45,204,148,51,45);shape(c,'triangle',230,171,20,true);
      c.drawImage(original,222,375,95,47,218,375,752,47);
      c.fillStyle='#e6d6bc';c.fillRect(349,422,623,58);
      // Restrained numbered path replaces the reference path occluded by people.
      c.strokeStyle='#b8875350';c.lineWidth=3;c.setLineDash([5,6]);c.beginPath();c.moveTo(166,361);c.lineTo(230,269);c.lineTo(486,183);c.lineTo(716,227);c.stroke();c.setLineDash([]);
    }
    if(scene.id==='F')prepareBridgeBackground(c,original);
    if(scene.id==='I')prepareChoicesBackground(c,original,backgrounds.C);
    if(scene.id==='J')prepareCubeBackground(c,original);
    backgrounds[scene.art]=b;
  }
  canvas.width=2000;canvas.height=960;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
  return {draw(world,base,actor,now,source){
    const me=world.players[actor],scene=SCENES[me.scene];ctx.setTransform(2,0,0,2,0,0);ctx.clearRect(0,0,1000,480);ctx.drawImage(backgrounds[scene.art],0,0);
    if(scene.id==='home')for(const [type,x]of [['scooter',380],['skateboard',622]])if(me.ride!==type)ride(ctx,type,x,365);
    if(scene.id==='street')for(const c of carsAt(now))car(ctx,c);
    if(scene.id==='F')drawBridge(ctx,world,base,actor,images);
    if(scene.id==='I')drawChoices(ctx,world);
    if(scene.id==='J')drawCubes(ctx,world,source,images,now);
    for(const o of world.routes[scene.id]||[]){if(o.owner)continue;const y=o.placed?scene.targets.find(t=>t.type==='pedestal'&&t.index===o.index).topY:o.y-5;shape(ctx,o.shape,o.x,y,o.placed?20:18);if(o.placed){ctx.strokeStyle='#f7d277';ctx.lineWidth=2;ctx.strokeRect(o.x-24,y-24,48,41);}}
    for(const t of scene.targets.filter(t=>t.type==='door'&&t.lock)){
      // Closed padlocks already belong to the approved door art.
      if(world.unlocked[t.lock]){
        const v=t.id==='door-1'?{x:74,y:145,w:31,h:98}:t.id==='door-3'?{x:898,y:145,w:31,h:98}:{x:721,y:43,w:52,h:65};
        const pulse=Math.max(0,1-(now-world.unlockAt)/1800);
        ctx.fillStyle='#263b35';ctx.fillRect(v.x,v.y,v.w,v.h);ctx.fillStyle='#efd08b';ctx.font='bold 9px system-ui';ctx.textAlign='center';ctx.fillText('OPEN',v.x+v.w/2,v.y+v.h-8);
        if(pulse>0){ctx.strokeStyle=`rgba(255,222,130,${pulse})`;ctx.lineWidth=5;ctx.strokeRect(v.x-pulse*8,v.y,v.w+pulse*16,v.h);}
      }
    }
    const visible=Object.values(world.players).filter(p=>p.instance===me.instance&&base.players[p.id].connected).sort((a,b)=>a.y-b.y);
    for(const p of visible){
      if(p.follower){const q=world.players[p.follower];ctx.strokeStyle='#dfb885';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(p.x,p.y-30);ctx.lineTo(q.x,q.y-30);ctx.stroke();}
      avatar(ctx,p,base.players[p.id],now,p.id===actor,atlas);
      if(p.resetUntil>now){ctx.fillStyle='#fff6db';ctx.font='bold 11px system-ui';ctx.textAlign='center';ctx.fillText('Back to the curb · try again',p.x,p.y-98);}
    }
    if(scene.id==='F')drawBridgeActors(ctx,world,actor,images);
    if(scene.id==='I')drawReversalActors(ctx,world);
    if(scene.id==='J')drawCubeActors(ctx,world,actor,images,now);
    const focus=nearest(world,actor);if(focus){ctx.strokeStyle='#e9bd69';ctx.lineWidth=1.8;ctx.setLineDash([4,3]);ctx.beginPath();ctx.ellipse(focus.x,focus.y+4,27,10,0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}
    if(me.transitionUntil>now){ctx.fillStyle=`rgba(243,234,217,${Math.min(.45,(me.transitionUntil-now)/1100)})`;ctx.fillRect(0,0,1000,480);}
  }};
}
