export const CUBES=[
  ['teal','diamond','Conduct',2,430,214],['red','circle','Identify',0,500,214],['amber','triangle','Gather',1,568,214],
  ['blue','cross','Learning needs',0,428,254],['violet','two bars','Literature review',2,500,254],['rose','star',"Stakeholders' opinions",1,570,254]
];
export function createCubes(){return {pairs:[false,false,false],matchedAt:[0,0,0],cubes:CUBES.map(([color,mark,text,pair,x,y],index)=>({id:`cube-${index}`,index,color,mark,text,pair,x,y,owner:null,placed:false}))};}
export function claimCube(w,id,target){
 const p=w.players[id],o=w.cubes.cubes.find(o=>o.id===target);
 if(p.carry)throw Error('Put down your cube before picking up another.');
 if(!o||o.owner||o.placed)throw Error('This cube has already been claimed.');
 o.owner=id;p.carry=o.id;return {kind:'ok'};
}
export function matchCubes(w,id,other,now){
 const p=w.players[id],q=w.players[other],a=w.cubes.cubes.find(o=>o.id===p.carry),b=w.cubes.cubes.find(o=>o.id===q.carry);
 if(id===other||!a||!b||a.owner!==id||b.owner!==other||p.scene!=='J'||q.scene!=='J')throw Error('Two nearby people must each hold one cube.');
 if(a.pair!==b.pair){p.mismatchUntil=now+900;q.mismatchUntil=now+900;return {kind:'toast',text:'Those words do not match. Both of you still hold your cubes.'};}
 if(w.cubes.pairs[a.pair])throw Error('This objective is already complete.');
 w.cubes.pairs[a.pair]=true;w.cubes.matchedAt[a.pair]=now;
 for(const [o,offset]of [[a,-15],[b,15]])Object.assign(o,{placed:true,owner:null,x:415+a.pair*86+offset,y:246});
 p.carry=null;q.carry=null;return {kind:'toast',text:'A match. The full objective is now on the monitor.'};
}
