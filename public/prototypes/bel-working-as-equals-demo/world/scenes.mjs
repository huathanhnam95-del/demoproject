// Coordinates are feet positions in the approved 1000 x 480 room composition.
export const WIDTH=1000, HEIGHT=480;
export const SHAPES=['triangle','square','circle'];
const box=(id,x,y,w,h)=>({id,x,y,w,h});
const target=(id,type,x,y,label,extra={})=>({id,type,x,y,label,...extra});
const door=(id,x,y,to,label='Door',extra={})=>target(id,'door',x,y,label,{to,...extra});
const floor=[box('main',150,128,700,262),box('sides',59,190,880,200),box('threshold',450,380,100,74)];
const plants=[box('plant-left',63,309,44,45),box('plant-right',891,309,45,45)];
const seats=()=>[0,1].flatMap(row=>[0,1,2].map(col=>target(`seat-${row}-${col}`,'seat',400+col*94,260+row*68,'Sit',{rect:box('seat',379+col*94,242+row*68,42,25)})));
const studio=(id)=>({id,title:`Studio ${id}`,art:id==='A'?'A':'C',floor,spawn:{x:500,y:370},
  solids:[...plants,box('monitor',375,113,210,16),box('console',613,134,40,28),...seats().map(s=>({...s.rect,id:s.id}))],
  targets:[target('monitor','monitor',631,175,'Presentation monitor'),...seats(),door('back',500,426,({A:'reception',C:'route',E:'D',G:'F'})[id],'Back'),
    ...(id==='A'?[door('door-1',99,249,'B1','Door 1',{lock:'A'}),door('door-2',747,148,'B2','Door 2',{lock:'A'}),door('door-3',900,249,'B3','Door 3',{lock:'A'})]:[door('onward',747,148,({C:'D',E:'F',G:'I'})[id],'Continue',{lock:id})])],
  erase:[{x:558,y:102,w:53,h:78,sampleX:300}],carpet:true});
const route=(id)=>({id,title:`Hurdle ${id.slice(1)} · ${id}`,art:'B',spawn:{x:166,y:362},
  floor:[box('room',91,143,816,233),box('lower',37,255,919,119),box('back-aisle',91,376,255,22),box('entry',124,363,71,87),box('exit',847,140,83,69)],
  solids:[box('pedestal-0',177,176,107,62),box('pedestal-1',430,94,118,65),box('pedestal-2',655,148,122,53),box('plant1',96,142,46,34),box('plant2',341,118,43,28),box('plant3',804,113,35,35)],
  targets:[door('back',166,422,'A','Back'),door('onward',883,165,'C','Continue'),
    ...SHAPES.map((shape,i)=>target(`pedestal-${i}`,'pedestal',[230,486,716][i],[256,179,221][i],['The thought','Why it happened','The shift'][i],{shape,index:i,topY:[171,88,135][i]}))],
  shapeSpawns:[{x:275,y:317},{x:453,y:299},{x:618,y:272}],
  erase:[{x:265,y:168,w:61,h:116,sampleX:340},{x:448,y:195,w:53,h:47,sampleX:337},{x:592,y:173,w:61,h:46,sampleX:558},{x:570,y:237,w:401,h:229,sampleX:342}],
  // The approved reference depicts one completed triangle; the runtime begins empty.
  emptyTriangle:true});
export const SCENES={
  home:{id:'home',title:'Home',art:'home',floor,spawn:{x:302,y:308},
    solids:[box('wardrobe',62,102,58,151),box('bookcase',568,101,171,28),box('side-table',886,196,40,44)],
    targets:[target('wardrobe','profile',145,200,'Change appearance'),target('scooter','ride',380,365,'Ride scooter',{ride:'scooter'}),target('skateboard','ride',622,365,'Ride skateboard',{ride:'skateboard'}),door('exit',500,426,'street','Leave Home')],
    erase:[{x:282,y:254,w:52,h:94,sampleX:230},{x:336,y:302,w:94,h:86,sampleX:442},{x:578,y:343,w:98,h:45,sampleX:442}]},
  street:{id:'street',title:'Street',art:'street',spawn:{x:278,y:412},
    floor:[box('street',25,128,950,330)],solids:[box('home-house',35,348,161,107),box('bench',827,126,70,25)],
    targets:[door('home',156,450,'home','Home'),door('bel',500,135,'reception','Enter BEL')],
    erase:[{x:732,y:165,w:154,h:79,sampleX:559},{x:104,y:236,w:169,h:87,sampleX:566},{x:280,y:294,w:91,h:104,sampleX:370},{x:472,y:303,w:48,h:103,sampleX:548},{x:662,y:307,w:73,h:103,sampleX:565}]},
  reception:{id:'reception',title:'Reception',art:'reception',floor,spawn:{x:520,y:237},
    solids:[box('counter',126,180,87,137),box('wardrobe',64,130,52,151),box('waiting',854,198,67,118),...plants],
    targets:[door('street',500,426,'street','Street'),door('studio',633,145,'A','Studio A')],
    erase:[{x:493,y:144,w:60,h:84,sampleX:670},{x:418,y:180,w:47,h:89,sampleX:672},{x:413,y:271,w:51,h:86,sampleX:672},{x:527,y:252,w:46,h:90,sampleX:672}]},
  A:studio('A'),B1:route('B1'),B2:route('B2'),B3:route('B3'),C:studio('C'),
  D:{id:'D',title:'Gallery D',art:'D',spawn:{x:500,y:406},
    floor:[box('gallery',145,174,710,279),box('open-center',30,282,940,106),box('upper-aisle',139,169,717,139),box('entry',452,410,95,70)],
    solids:[box('notes-table',404,277,193,49),box('bench',48,354,120,42),box('left-plant',150,152,42,34),box('right-plant',744,152,35,26)],
    targets:[door('back',500,446,'C','Studio C'),door('end',824,178,'E','Studio E'),target('table','notes',500,348,'Compare observations'),
      ...['Chet Faliszek','Josh Weier','Mike Morasky','Erik Wolpaw','Rich Geldreich'].map((name,i)=>target(`portrait-${i}`,'portrait',[145,294,483,669,857][i],[285,190,190,190,285][i],name,{index:i}))],
    erase:[{x:140,y:185,w:48,h:100,sampleX:200},{x:340,y:209,w:48,h:99,sampleX:270},{x:641,y:270,w:45,h:98,sampleX:716},{x:817,y:185,w:45,h:100,sampleX:716}]},
  E:studio('E'),G:studio('G'),
  F:{id:'F',title:'Bridge room / F',art:'F',spawn:{x:500,y:375},
    floor:[box('near',60,235,880,155),box('entry',430,380,133,74),box('far',153,110,696,45),box('crossing',459,145,82,102)],
    solids:[box('plant-l',63,316,45,42),box('plant-r',895,316,41,42),box('far-plant-l',178,105,46,20),box('far-plant-r',617,105,37,20),box('far-plant-r2',774,105,40,20)],
    targets:[door('back',500,428,'E','Studio E'),door('onward',704,135,'G','Studio G')],erase:[]},
  I:{id:'I',title:'Floor choices / I',art:'I',floor,spawn:{x:500,y:370},
    solids:[...plants,box('monitor',375,113,210,16),box('console',613,134,40,28),box('upper-plant-l',271,100,38,29),box('upper-plant-r',660,100,30,30)],
    targets:[target('monitor','monitor',631,175,'Presentation monitor'),door('back',500,426,'G','Studio G'),door('onward',747,148,'J','Continue',{lock:'I'})]},
  J:{id:'J',title:'Cube matching / J',art:'J',floor,spawn:{x:500,y:370},
    solids:[...plants,box('monitor',335,126,329,17),box('console',709,136,39,29),box('table',374,211,252,78),box('plant-upper-l',250,98,32,30),box('plant-upper-r',742,98,35,30)],
    targets:[target('monitor','monitor',729,177,'Final presentation monitor'),door('back',500,426,'I','Room I')]}
};
export const instance=(id,scene)=>scene==='home'?`home:${id}`:scene;
export const sceneFor=p=>SCENES[p.scene];
export function entry(scene,id,from) {
  const offset=Number(id[1])*27;
  if(scene==='street') return {x:310+offset,y:410};
  if(scene==='reception' && from==='street') return {x:465+offset,y:372};
  if(scene==='home') return {x:500,y:368};
  if(scene==='A' && from?.startsWith('B')) return {x:180+offset,y:300};
  if(['C','E','G'].includes(scene)) return {x:451+offset,y:370};
  if(scene==='F') return {x:350+Number(id[1])*68,y:375};
  if(scene==='I') return {x:470+Number(id[1])*21,y:365};
  if(scene==='J') return {x:450+Number(id[1])*30,y:370};
  if(scene==='D') return {x:451+offset,y:393};
  return {...SCENES[scene].spawn};
}
