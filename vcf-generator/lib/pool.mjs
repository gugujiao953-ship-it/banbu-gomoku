import { Worker } from 'node:worker_threads';

// Each lane runs one generation job at a time. Only immutable geometry stays
// warm between jobs; generate() creates fresh RNG, budgets and board state.
export async function runJobs(jobs,{workers=1,cancellation=new SharedArrayBuffer(4),onProgress=()=>{}}={}){
  // 第 25 轮：上限从 4 放到 16（实测 12 核机器上 4 泳道只拿到 1.5-1.8×，尾巴任务与核亲和
  // 都还有余量；上限只是防呆，真正的并行度由调用方按机器给）。
  if(!Array.isArray(jobs)||!Number.isInteger(workers)||workers<1||workers>16)throw new Error('Invalid worker pool options');
  const flag=new Int32Array(cancellation),results=new Array(jobs.length),running=[];
  let cursor=0;
  const runOne=(worker,options,number)=>new Promise((done,fail)=>{
    const cleanup=()=>{worker.off('message',message);worker.off('error',error);worker.off('exit',exit);};
    const error=e=>{cleanup();fail(e);};
    const exit=code=>error(new Error('Worker exited without job result: '+code));
    const message=msg=>{
      if(msg.job!==number)return;
      if(msg.type==='progress'){try{onProgress(number,msg.progress);}catch(e){error(e);}}
      else if(msg.type==='error')error(new Error('Job '+number+': '+msg.error));
      else if(msg.type==='result'){cleanup();done(msg.result);}
    };
    worker.on('message',message);worker.once('error',error);worker.once('exit',exit);
    try{worker.postMessage({options,job:number});}catch(e){error(e);}
  });
  try{
    await Promise.all(Array.from({length:Math.min(workers,jobs.length)},async()=>{
      if(Atomics.load(flag,0))return;
      const worker=new Worker(new URL('../worker.mjs',import.meta.url),{
        workerData:{persistent:true,cancel:cancellation},resourceLimits:{maxOldGenerationSizeMb:2048}});
      running.push(worker);
      // Avoid an unhandled error if startup fails between two job listeners.
      worker.on('error',()=>{});
      while(cursor<jobs.length&&!Atomics.load(flag,0)){
        const i=cursor++;results[i]=await runOne(worker,jobs[i],i+1);
      }
    }));
    return results;
  }finally{await Promise.allSettled(running.map(worker=>worker.terminate()));}
}
