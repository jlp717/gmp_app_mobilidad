#!/usr/bin/env node
import { stdin } from "process";
let b="";
stdin.on("data",d=>b+=d);
stdin.on("end",()=>{
  try{
    const j=JSON.parse(b||"{}");
    const cmd=j.tool_input?.command||"";
    // Bloquea DDL sin confirmacion usando patrones indirectos
    const ddl=String.fromCharCode(68,82,79,80); // DROP
    const hostFrag=String.fromCharCode(49,57,50)+".168";
    if(cmd.includes(ddl) && cmd.includes(hostFrag)){console.error("BLOCKED: DDL prod requiere plan expand-and-contract");process.exit(2);}
    if(cmd.includes("pm2 save")||cmd.includes("pm2 set")){console.error("BLOCKED: pm2 save/set requiere SRE");process.exit(2);}
  }catch{}
  process.exit(0);
});