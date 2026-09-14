export const RADIUS=10;
export const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export const inside=(p,r,margin=0)=>p.x>=r.x+margin&&p.x<=r.x+r.w-margin&&p.y>=r.y+margin&&p.y<=r.y+r.h-margin;
export const intersects=(p,r,radius=RADIUS)=>p.x+radius>r.x&&p.x-radius<r.x+r.w&&p.y+radius>r.y&&p.y-radius<r.y+r.h;
export function valid(p,scene,solids=scene.solids,radius=RADIUS){
  // Four feet corners must lie in the union of walkable floor rectangles.
  return [-radius,radius].every(dx=>[-radius,radius].every(dy=>scene.floor.some(r=>inside({x:p.x+dx,y:p.y+dy},r))))&&!solids.some(r=>intersects(p,r,radius));
}
export function move(p,dx,dy,scene,solids=scene.solids,radius=RADIUS){
  const count=Math.max(1,Math.ceil(Math.hypot(dx,dy)/4));
  const next={x:p.x,y:p.y};
  for(let i=0;i<count;i++){
    const x={x:next.x+dx/count,y:next.y}; if(valid(x,scene,solids,radius)) next.x=x.x;
    const y={x:next.x,y:next.y+dy/count}; if(valid(y,scene,solids,radius)) next.y=y.y;
  }
  return next;
}
export function safeAnchor(preferred,scene,solids=scene.solids,radius=RADIUS){
  if(valid(preferred,scene,solids,radius)) return {...preferred};
  for(let r=8;r<=160;r+=8) for(let a=0;a<Math.PI*2;a+=Math.PI/8){
    const p={x:preferred.x+Math.cos(a)*r,y:preferred.y+Math.sin(a)*r};
    if(valid(p,scene,solids,radius)) return p;
  }
  throw Error('No safe floor anchor');
}
export function vector(keys){
  const x=Number(keys.d)-Number(keys.a),y=Number(keys.s)-Number(keys.w),m=Math.hypot(x,y)||1;
  return {x:x/m,y:y/m};
}
