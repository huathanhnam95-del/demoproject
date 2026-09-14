import {PHASES,PLANKS,plankPosition} from '../activities/bridge.mjs';
import {QUESTIONS} from '../activities/reversal.mjs';
function wrap(c,text,x,y,width,line=14){let row='',yy=y;for(const word of text.split(' ')){const next=row?row+' '+word:word;if(c.measureText(next).width>width&&row){c.fillText(row,x,yy);yy+=line;row=word;}else row=next;}c.fillText(row,x,yy);return yy+line;}
export function plank(c,img,index,x,y,width=79){
  const ys=[445,410,376,340,306,275];c.drawImage(img,764,ys[index],142,33,x-width/2,y-12,width,21);
}
export function prepareBridgeBackground(c,original){
  const tile=document.createElement('canvas');tile.width=75;tile.height=46;tile.getContext('2d').drawImage(original,500,283,75,46,0,0,75,46);
  // Clear the reference presenter where his head overlaps the channel rim.
  c.drawImage(original,245,202,44,39,140,202,44,39);
  c.fillStyle=c.createPattern(tile,'repeat');c.beginPath();
  for(const [i,[x,y]]of [[144,220],[444,220],[444,242],[556,242],[556,220],[855,220],[939,265],[939,390],[61,390],[61,265]].entries())i?c.lineTo(x,y):c.moveTo(x,y);
  c.closePath();c.fill();
  // Static native plants remain separate from the live cast and movable boards.
  for(const [x,y,w,h]of [[61,274,48,85],[888,274,54,87]])c.drawImage(original,x,y,w,h,x,y,w,h);
}
export function drawBridge(c,w,base,actor,images){
  const f=w.bridge,img=images['F-complete'];
  f.planks.filter(o=>!o.owner&&!o.placed).forEach(o=>plank(c,img,o.index,o.x,o.y,86));
  // Source room initially contains dashed guide positions, not solid floor.
  for(let i=0;i<f.placed;i++){const p=plankPosition(i);plank(c,img,i,p.x,p.y);}
  const count=Math.floor(f.placed/2);
  for(let i=0;i<count;i++){
    const x=230+i*128;c.drawImage(images['F-complete'],378+i*211,74,210,130,x,20,126,78);
    // The source panel image is preserved; crisp source text at game scale sits
    // on the same cream face, with no extra nested container.
    c.fillStyle='#fff7e8';c.fillRect(x+6,28,115,65);c.fillStyle='#102347';c.textAlign='center';c.font='bold 10px system-ui';c.fillText(PHASES[i],x+62,42);
    c.font='9px system-ui';let y=54;y=wrap(c,PLANKS[i*2][2],x+62,y,104,11);wrap(c,PLANKS[i*2+1][2],x+62,y+1,104,11);
  }
}
export function drawBridgeActors(c,w,actor,images){
  for(const p of Object.values(w.players))if(p.scene==='F'&&p.connected!==false&&p.carry){const o=w.bridge.planks.find(o=>o.id===p.carry);if(o)plank(c,images['F-complete'],o.index,p.x,p.y-28,69);}
  const me=w.players[actor],o=w.bridge.planks.find(o=>o.id===(me.carry||me.inspect));
  if(o){
    const x=Math.max(105,Math.min(895,me.x)),y=me.y-144;c.fillStyle='#fff8e7';c.strokeStyle='#714d2d';c.lineWidth=2;c.beginPath();c.roundRect(x-96,y,192,48,17);c.fill();c.stroke();c.beginPath();c.arc(x-15,y+54,4,0,7);c.fill();
    c.fillStyle='#142744';c.textAlign='center';c.font='600 12px system-ui';wrap(c,o.text,x,y+19,178,16);
  }
}
export function prepareChoicesBackground(c,original,studio){
  c.drawImage(original,700,106,29,26,583,106,29,26);c.fillStyle='#192e3b';c.fillRect(575,107,9,21);
  const tile=document.createElement('canvas');tile.width=80;tile.height=60;tile.getContext('2d').drawImage(original,451,160,80,60,0,0,80,60);
  c.fillStyle=c.createPattern(tile,'repeat');c.beginPath();for(const [i,[x,y]]of [[149,130],[850,130],[940,265],[940,390],[60,390],[60,265]].entries())i?c.lineTo(x,y):c.moveTo(x,y);c.closePath();c.fill();
  for(const [x,y,w,h]of [[270,61,49,70],[659,61,38,74],[614,101,40,65],[61,275,50,85],[887,275,53,85]])c.drawImage(original,x,y,w,h,x,y,w,h);
  c.fillStyle='#9fbd947f';c.fillRect(125,185,305,186);c.fillStyle='#d9877b7f';c.fillRect(571,185,305,186);
  c.textAlign='center';c.font='bold 66px system-ui';c.fillStyle='#487c51';c.fillText('✓',278,276);c.font='bold 36px system-ui';c.fillText('Do',278,330);
  c.fillStyle='#9c4539';c.font='bold 70px system-ui';c.fillText('×',724,276);c.font='bold 36px system-ui';c.fillText("Don't",724,330);
}
export function cube(c,img,index,x,y,size=29){const xy=[[694,371],[811,371],[925,371],[689,438],[809,438],[926,438]][index];c.drawImage(img,...xy,58,58,x-size/2,y-size/2,size,size);}
export function prepareCubeBackground(c,original){
  const tile=document.createElement('canvas');tile.width=70;tile.height=50;tile.getContext('2d').drawImage(original,200,175,70,50,0,0,70,50);
  c.fillStyle=c.createPattern(tile,'repeat');c.beginPath();for(const [i,[x,y]]of [[148,137],[850,137],[940,265],[940,390],[60,390],[60,265]].entries())i?c.lineTo(x,y):c.moveTo(x,y);c.closePath();c.fill();
  c.drawImage(original,786,105,50,33,657,105,50,33);
  for(const [x,y,w,h]of [[247,61,47,76],[734,61,50,76],[708,102,43,65],[61,274,50,86],[888,274,54,86]])c.drawImage(original,x,y,w,h,x,y,w,h);
  c.drawImage(original,370,187,260,96,370,187,260,96);
  const wood=document.createElement('canvas');wood.width=29;wood.height=36;wood.getContext('2d').drawImage(original,377,215,29,36,0,0,29,36);
  c.fillStyle=c.createPattern(wood,'repeat');c.beginPath();c.moveTo(380,190);c.lineTo(619,190);c.lineTo(627,282);c.lineTo(372,282);c.closePath();c.fill();
  c.drawImage(original,381,283,40,12,372,283,255,12);
  for(const x of [376,617])c.drawImage(original,x,290,11,29,x,290,11,29);
}
export function drawCubes(c,w,source,images,now){
  const state=w.cubes;c.fillStyle='#c3d5f0';c.fillRect(344,34,311,99);c.fillStyle='#172e49';c.textAlign='center';c.font='bold 13px system-ui';c.fillText(state.pairs.every(Boolean)?'Three pairs complete':'Match the cubes',500,48);
  state.pairs.forEach((done,i)=>{const y=62+i*26;if(done){const o=source.objectives[i];c.font='bold 10px system-ui';c.fillText(o.title,500,y,300);c.font='9px system-ui';c.fillText(o.detail,500,y+12,301);}else{c.font='bold 18px system-ui';c.fillText('?',500,y+7);}});
  state.cubes.filter(o=>!o.owner).forEach(o=>{cube(c,images.J,o.index,o.x,o.y);if(o.placed&&now-state.matchedAt[o.pair]<1800){c.strokeStyle='#ffdf8d';c.lineWidth=3;c.strokeRect(o.x-16,o.y-16,32,32);}});
}
export function drawCubeActors(c,w,actor,images,now){
  for(const p of Object.values(w.players))if(p.scene==='J'&&p.connected!==false&&p.carry){const o=w.cubes.cubes.find(o=>o.id===p.carry);if(o)cube(c,images.J,o.index,p.x+(p.mismatchUntil>now?Math.sin(now/35)*3:0),p.y-29,26);}
  const me=w.players[actor],o=w.cubes.cubes.find(o=>o.id===me.carry);if(!o)return;
  const x=Math.max(110,Math.min(890,me.x)),y=me.y-143;c.fillStyle='#fff8e7';c.strokeStyle='#76522f';c.lineWidth=2;c.beginPath();c.roundRect(x-95,y,190,44,16);c.fill();c.stroke();c.fillStyle='#142944';c.font='600 13px system-ui';c.textAlign='center';wrap(c,o.text,x,y+18,174,16);
}
export function drawChoices(c,w){
  const r=w.reversal,q=QUESTIONS[r.index],feedback=['interval','complete'].includes(r.phase);
  c.fillStyle='#c3d5f0';c.fillRect(384,39,191,77);c.fillStyle='#132342';c.font='600 12px system-ui';c.textAlign='center';
  const text=r.phase==='gathering'?"Move to choose. Read the whole sentence before the five seconds end.":r.phase==='opening'?q[0].replace(/,$/,'…'):q[0]+' '+q[1];
  wrap(c,text,479,56,182,14);
  if(feedback){c.lineWidth=5;c.strokeStyle='#edc774';c.strokeRect(q[2]==='Do'?125:571,185,305,186);}
}
export function drawReversalActors(c,w){
  for(const p of Object.values(w.players))if(p.scene==='I'&&p.connected!==false&&w.reversal.debuffs[p.id]>0){
    c.strokeStyle='#9254ce';c.lineWidth=3;c.beginPath();for(let t=0;t<Math.PI*5;t+=.16){const x=p.x+Math.cos(t)*t*.55,y=p.y-111+Math.sin(t)*t*.55;t?c.lineTo(x,y):c.moveTo(x,y);}c.stroke();
    const label=`Reversed controls 00:${String(Math.ceil(w.reversal.debuffs[p.id]/1000)).padStart(2,'0')}`;c.font='600 10px system-ui';c.textAlign='center';const width=c.measureText(label).width+12;c.fillStyle='#fbf3ff';c.fillRect(p.x-width/2,p.y-141,width,18);c.fillStyle='#623791';c.fillText(label,p.x,p.y-128);
  }
}
