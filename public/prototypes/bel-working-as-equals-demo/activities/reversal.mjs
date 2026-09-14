// Authored activity scenarios grounded in slide 19, not quotations from it.
export const QUESTIONS=[
 ['I choose work that fits my teaching strengths,','and I take responsibility for moving it forward.','Do','Freedom and ownership go together.'],
 ['I ask a colleague for advice,','but I stop ordinary helpful work until they give me permission.',"Don't",'Advice is useful; ordinary helpful work does not need an approval gate.'],
 ['I want my colleague to feel respected,','so I discuss the draft directly and suggest an improvement.','Do','Be direct about the work and caring toward the person.'],
 ['I want to avoid an awkward conversation,','so I complain about the draft to everyone except its author.',"Don't",'Bring concerns to the person, not around them.'],
 ['I prefer working late,','but my colleagues are free to reply tomorrow.','Do',"Your chosen schedule respects colleagues' rest."],
 ['I prefer working late,','so I expect my colleagues to stay online with me.',"Don't",'A personal preference should not impose on others.']
];
export function createReversal(){return {phase:'gathering',index:0,remaining:0,results:[],debuffs:{p1:0,p2:0,p3:0}};}
export function choiceAt(p){
 if(p.leader)return null;
 if(p.y<195||p.y>361)return null;
 if(p.x>=135&&p.x<=420)return 'Do';
 if(p.x>=581&&p.x<=866)return "Don't";
 return null;
}
export const choiceReady=(w,b)=>Object.values(b.players).every(p=>p.connected&&p.ready&&w.players[p.id].scene==='I');
export function startReversal(w,b){
 if(!choiceReady(w,b))throw Error('Wait for all three participants in I.');
 if(w.reversal.phase!=='gathering')throw Error('The activity has already started.');
 Object.assign(w.reversal,{phase:'opening',remaining:3000});
}
export function tickReversal(w,b,elapsed,paused){
 const r=w.reversal;
 for(const id of ['p1','p2','p3'])if(w.players[id].scene!=='I')r.debuffs[id]=0;
 if(paused||!choiceReady(w,b)||['gathering','complete'].includes(r.phase))return;
 for(const id of ['p1','p2','p3'])r.debuffs[id]=Math.max(0,r.debuffs[id]-elapsed);
 r.remaining=Math.max(0,r.remaining-elapsed);if(r.remaining>0)return;
 if(r.phase==='opening'){r.phase='choice';r.remaining=5000;return;}
 if(r.phase==='choice'){
   const result={index:r.index,answer:QUESTIONS[r.index][2],players:{}};
   for(const id of ['p1','p2','p3']){
     const choice=choiceAt(w.players[id]),correct=choice===result.answer;result.players[id]={choice,correct,linked:!!w.players[id].leader};
     if(!correct&&r.debuffs[id]===0)r.debuffs[id]=20000;
   }
   r.results.push(result);
   if(r.index===QUESTIONS.length-1){r.phase='complete';r.remaining=0;for(const id of ['p1','p2','p3'])r.debuffs[id]=0;}
   else{r.phase='interval';r.remaining=10000;}return;
 }
 r.index++;r.phase='opening';r.remaining=3000;
}
