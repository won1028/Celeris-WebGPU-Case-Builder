/* Python runs off the UI thread. Preview and export share engine.py. */
let runtime;
async function ready(){
  if(!runtime) runtime=(async()=>{
    postMessage({type:'log',message:'Loading the Python runtime…'});
    importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js');
    const p=await loadPyodide();
    const response=await fetch('engine.py');if(!response.ok)throw Error('Could not load engine.py.');
    p.FS.writeFile('engine.py',await response.text());
    await p.runPythonAsync('from engine import *');
    p.globals.set('report_progress',m=>postMessage({type:'log',message:m}));
    return p;
  })();
  return runtime;
}
let chain=Promise.resolve();
onmessage=({data})=>{chain=chain.then(async()=>{
  try{
    const p=await ready();p.globals.set('settings_json',JSON.stringify(data.settings));
    if(data.type==='preview'){
      const result=JSON.parse(await p.runPythonAsync('json.dumps(build(json.loads(settings_json)), allow_nan=False)'));
      postMessage({type:'preview',id:data.id,result});
    }else{
      const bytes=await p.runPythonAsync('export_zip(json.loads(settings_json), report_progress)');
      const arr=bytes.toJs ? bytes.toJs() : bytes; if(bytes.destroy)bytes.destroy();
      postMessage({type:'export',id:data.id,bytes:arr},[arr.buffer]);
    }
  }catch(e){postMessage({type:'error',id:data.id,message:String(e.message||e).trim().split('\n').slice(-1)[0]});}
});};
