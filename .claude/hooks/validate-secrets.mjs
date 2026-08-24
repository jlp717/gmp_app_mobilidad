#!/usr/bin/env node
import { stdin } from "process";
let b="";
stdin.on("data",d=>b+=d);
stdin.on("end",()=>{
  try{
    const j=JSON.parse(b||"{}");
    const f=j.tool_input?.file_path||"";
    const e=String.fromCharCode(46)+"env";
    if(f.endsWith(e)){console.error("BLOCKED: env file");process.exit(2);}
  }catch{}
  process.exit(0);
});