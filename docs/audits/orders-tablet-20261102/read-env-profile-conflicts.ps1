[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$taskRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$profile=(& git -C $taskRoot show 'f4b025a:backend/config/app-profile.js') -join "`n"
if($LASTEXITCODE -ne 0){throw 'PROFILE_SOURCE_UNAVAILABLE'}
$loader=(& git -C $taskRoot show 'f4b025a:backend/config/load-env.js') -join "`n"
if($LASTEXITCODE -ne 0){throw 'LOADER_SOURCE_UNAVAILABLE'}
$profile64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($profile))
$loader64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($loader))
$job=@'
'use strict';
const Module=require('module'),crypto=require('crypto');
const profileSource=Buffer.from('PROFILE_SOURCE','base64').toString('utf8');
const loaderSource=Buffer.from('LOADER_SOURCE','base64').toString('utf8');
const profileModule=new Module(process.cwd()+'/config/app-profile.reviewed.js',module);
profileModule.filename=process.cwd()+'/config/app-profile.reviewed.js';
profileModule._compile(profileSource,profileModule.filename);
const loaderModule=new Module(process.cwd()+'/config/load-env.reviewed.js',module);
loaderModule.filename=process.cwd()+'/config/load-env.reviewed.js';
loaderModule.require=request=>{
 if(request==='./app-profile')return profileModule.exports;
 if(['fs','path','cluster','dotenv'].includes(request))return require(request);
 throw Object.assign(new Error('UNREVIEWED_DEPENDENCY'),{code:'UNREVIEWED_DEPENDENCY'});
};
loaderModule._compile(loaderSource,loaderModule.filename);
const fingerprint=text=>crypto.createHash('sha256').update(text).digest('hex');
try{
 loaderModule.exports.loadEnv(process.cwd());
 const evidence={operation:'environment routing diagnosis only',readOnly:true,databaseConnections:0,mutations:0,sourceCommit:'f4b025a',sourceHashes:{profile:fingerprint(profileSource),loader:fingerprint(loaderSource)},profiles:{}};
 for(const appEnv of ['test','demo','production']){
  const result=profileModule.exports.resolveAppProfile({...process.env,APP_ENV:appEnv});
  const conflicts=[...new Set(result.errors.map(text=>/^([A-Z][A-Z0-9_]+)(?:=| )/.exec(text)?.[1]||'PROFILE_FLAG_COMBINATION'))];
  evidence.profiles[appEnv]={valid:result.valid,errorCount:result.errors.length,conflicts:conflicts.map(name=>({name,expected:result.assignments[name]??null})),publicProfile:result.publicProfile};
 }
 process.stdout.write(JSON.stringify(evidence)+'\n');
}catch(error){process.stdout.write(JSON.stringify({readOnly:true,databaseConnections:0,success:false,code:/^[A-Z][A-Z0-9_]{2,70}$/.test(error.code||'')?error.code:'ENV_DIAGNOSTIC_FAILED'})+'\n');process.exitCode=1;}
'@
$job=$job.Replace('PROFILE_SOURCE',$profile64).Replace('LOADER_SOURCE',$loader64)
$job | & 'C:\Program Files\Git\usr\bin\ssh.exe' -o BatchMode=yes -o ConnectTimeout=10 gmp@192.168.1.230 'cd /opt/gmp-api/backend && node -'
exit $LASTEXITCODE
