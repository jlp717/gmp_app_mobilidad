require('dotenv').config({path:require('path').join(__dirname,'../.env')});
const odbc=require('odbc');const http=require('http');const UA='GMP-Mandato-V5/1.0';
const { getProbeCredentials } = require('./probe-credentials');
function cs(){const p=process.env.ODBC_PWD||process.env.ODBC_PASSWORD;return `DSN=GMP;UID=JAVIER;PWD=${p};NAM=1;CCSID=1208;CMPTDM=1;CPTOUT=120;COMMTIMEOUT=180;DBQ=GMP`;}
function call(method,path,body,token,extra={}){return new Promise((res,rej)=>{const d=body?JSON.stringify(body):null;const h={'User-Agent':UA,...extra};if(token)h.Authorization='Bearer '+token;if(d){h['Content-Type']='application/json';h['Content-Length']=Buffer.byteLength(d);}const r=http.request({hostname:'127.0.0.1',port:3335,path:'/api'+path,method,headers:h},x=>{let b='';x.on('data',c=>b+=c);x.on('end',()=>res({status:x.statusCode,body:JSON.parse(b||'{}')}));});r.on('error',rej);if(d)r.write(d);r.end();});}
(async()=>{const out={};const login=await call('POST','/auth/login',getProbeCredentials('mandato v5 final'));const t=login.body.token;
const cob=await call('GET','/cobros/pending-summary/093',null,t);out.cobros={grandTotal:cob.body.grandTotal,clientCount:cob.body.clientCount};
const conn=await odbc.connect(cs());
for(const v of ['93','093']){const r=await conn.query(`SELECT COALESCE(SUM(CVC.IMPORTEPENDIENTE),0) GT FROM DSEDAC.CVC CVC WHERE CVC.IMPORTEPENDIENTE<>0 AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN<>'S') AND EXISTS (SELECT 1 FROM DSEDAC.CLP CLP WHERE TRIM(CLP.CODIGOCLIENTE)=TRIM(CVC.CODIGOCLIENTEALBARAN) AND TRIM(CLP.VENDEDORCOMERCIAL)=?)`,[v]);out['db2_'+v]=Number(r[0].GT);}
const client='4300000354';
const p=await call('GET','/pedidos/products?vendedorCodes=093&clientCode='+client+'&limit=2',null,t);
out.products={status:p.status,count:(p.body.products||[]).length,error:p.body.error,first:(p.body.products||[])[0]?.code};
const prod=(p.body.products||[])[0];
if(prod){const idem='mandato-v5-'+Date.now();const cr=await call('POST','/pedidos/create',{clientCode:client,clientName:'Mandato V5',vendedorCode:'093',lines:[{codigoArticulo:prod.code||prod.codigoArticulo,descripcion:prod.name||'t',cantidadEnvases:1,precio:Number(prod.price||prod.precio||1),precioCosto:0.5}]},t,{'Idempotency-Key':idem});
const oid=cr.body.order?.id||cr.body.order?.header?.id;out.create={status:cr.status,oid,error:cr.body.error};
if(oid){const cf=await call('PUT','/pedidos/'+oid+'/confirm',{tipoventa:'CC'},t);out.confirm={status:cf.status,error:cf.body?.error};
const det=await call('GET','/pedidos/'+oid,null,t);const h=det.body.order?.header||{};out.api={terminal:h.terminal,serie:h.serie,numero:h.numeroPedido,vend:h.vendedor};
const db=await conn.query('SELECT ID,TERMINAL,TERMINALPEDIDO,NUMEROPEDIDO,SERIEPEDIDO,TRIM(CODIGOVENDEDOR) V,SYNC_STATUS FROM JAVIER.PEDIDOS_CAB WHERE ID=?',[oid]);
out.db2=db[0];const term=db[0].TERMINALPEDIDO??db[0].TERMINAL;out.formatted='P-'+String(term).padStart(3,'0')+'-'+String(db[0].NUMEROPEDIDO).padStart(6,'0');
const cpc=await conn.query('SELECT COUNT(*) C FROM DSEDAC.CPC WHERE EJERCICIOPEDIDO=2026 AND TRIM(SERIEPEDIDO)=? AND TERMINALPEDIDO=? AND NUMEROPEDIDO=?',['P',term,db[0].NUMEROPEDIDO]);out.dsedacCpc=Number(cpc[0].C);}}
await conn.close();console.log(JSON.stringify(out,null,2));})().catch(e=>{console.error(e);process.exit(1);});
