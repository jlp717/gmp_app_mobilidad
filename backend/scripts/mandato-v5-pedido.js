require('dotenv').config({path:require('path').join(__dirname,'../.env')});
const http=require('http');const UA='GMP-Mandato-V5/1.0';
const { getProbeCredentials } = require('./probe-credentials');
function call(method,path,body,token,extra={}){return new Promise((res,rej)=>{const d=body?JSON.stringify(body):null;const h={'User-Agent':UA,...extra};if(token)h.Authorization='Bearer '+token;if(d){h['Content-Type']='application/json';h['Content-Length']=Buffer.byteLength(d);}const r=http.request({hostname:'127.0.0.1',port:3335,path:'/api'+path,method,headers:h},x=>{let b='';x.on('data',c=>b+=c);x.on('end',()=>res({status:x.statusCode,body:JSON.parse(b||'{}')}));});r.on('error',rej);if(d)r.write(d);r.end();});}
(async()=>{const login=await call('POST','/auth/login',getProbeCredentials('mandato v5 pedido'));const t=login.body.token;const client='4300000354';
const p=await call('GET','/pedidos/products?vendedorCodes=93&clientCode='+client+'&limit=2',null,t);
console.log('products',p.status,(p.body.products||[]).length);
const prod=(p.body.products||[])[0];if(!prod)process.exit(0);
const cr=await call('POST','/pedidos/create',{clientCode:client,clientName:'Mandato V5',vendedorCode:'093',lines:[{codigoArticulo:prod.code,descripcion:'MV5',cantidadEnvases:1,precio:Number(prod.price||1),precioCosto:0.5}]},t,{'Idempotency-Key':'mv5-'+Date.now()});
const oid=cr.body.order?.id;console.log('create',cr.status,cr.body.error,oid);
if(!oid)return;const cf=await call('PUT','/pedidos/'+oid+'/confirm',{tipoventa:'CC'},t);console.log('confirm',cf.status,cf.body.error);
const det=await call('GET','/pedidos/'+oid,null,t);const h=det.body.order?.header||{};console.log('result',JSON.stringify({id:oid,terminal:h.terminal,serie:h.serie,numero:h.numeroPedido,vend:h.vendedor,fmt:'P-'+String(h.terminal).padStart(3,'0')+'-'+String(h.numeroPedido).padStart(6,'0')}));})();
