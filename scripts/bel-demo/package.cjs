// Produce a finite, hash-verified static site outside the checkout.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const repo=path.resolve(__dirname,'../..');
const root=path.join(repo,'public/prototypes/bel-working-as-equals-demo');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const relative=(root,file)=>path.relative(root,file).split(path.sep).join('/');
const manifestPath=path.join(root,'presentation/source-manifest.json');
function build(destination){
  if(!destination)throw Error('Usage: node scripts/bel-demo/package.cjs <new external directory>');
  const out=path.resolve(destination),rel=path.relative(repo,out);
  if(!rel||(!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel)))throw Error('Output must be outside the repository');
  if(fs.existsSync(out))throw Error('Output directory already exists; choose a new directory');
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8').replace(/^\uFEFF/,'')),entries=[];
  function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){
    const file=path.join(dir,item.name);
    if(item.isSymbolicLink())throw Error('Source symlinks are not allowed');
    if(item.isDirectory())walk(file);
    else if(/\.(mjs|css|html)$/.test(item.name)){const bytes=fs.readFileSync(file);entries.push({url:relative(root,file),source:file,sourceSha256:hash(bytes),bytes});}
  }}
  walk(root);
  for(const input of manifest.inputs){
    const url=input.url.slice(1);
    if(!input.url.startsWith('/')||url.split('/').some(p=>!p||p==='..'||p==='.')||url.includes('\\'))throw Error('Invalid input alias');
    let bytes=fs.readFileSync(input.path);
    if(hash(bytes)!==input.sha256||bytes.length!==input.bytes)throw Error(`Input provenance mismatch: ${input.url}`);
    if(input.url==='/native/deck.html')bytes=Buffer.from(bytes.toString('utf8').replace('</body>','<script type="module" src="../presentation/frame.mjs"></script></body>'));
    entries.push({url,source:input.path,sourceSha256:input.sha256,bytes});
  }
  if(new Set(entries.map(e=>e.url.toLowerCase())).size!==entries.length)throw Error('Duplicate output alias');
  const site=path.join(out,'site');fs.mkdirSync(site,{recursive:true});
  const files=entries.sort((a,b)=>a.url.localeCompare(b.url)).map(({bytes,...entry})=>{
    const target=path.join(site,...entry.url.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
    return {...entry,bytes:bytes.length,sha256:hash(bytes)};
  });
  const record={schemaVersion:1,createdAt:new Date().toISOString(),site,sourceManifestSha256:hash(fs.readFileSync(manifestPath)),externalDependencies:manifest.externalDependencies,files};
  fs.writeFileSync(path.join(out,'package-manifest.json'),JSON.stringify(record,null,2)+'\n');
  return {site,files:files.length,manifestSha256:hash(fs.readFileSync(path.join(out,'package-manifest.json')))};
}
if(require.main===module){try{console.log(JSON.stringify(build(process.argv[2]),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={build};
