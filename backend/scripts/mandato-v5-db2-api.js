require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const odbc = require('odbc');
const http = require('http');
const UA = 'GMP-Mandato-V5/1.0';
function cs(){const pwd=process.env.ODBC_PWD||process.env.ODBC_PASSWORD;return `DSN=${process.env.ODBC_DSN||'GMP'};UID=${process.env.ODBC_UID||'JAVIER'};PWD=${pwd};NAM=1;CCSID=1208;CMPTDM=1;CPTOUT=120;COMMTIMEOUT=180;DBQ=${process.env.ODBC_DSN||'GMP'}`;}
function req(method,path,body,token,extra={}){return new Promise((resolve,reject)=>{const d=body?JSON.stringify(body):null;const h={'User-Agent':UA,...extra};if(token)h.Authorization='Bearer '+token;if(d){h['Content-Type']='application/json';h['Content-Length']=Buffer.byteLength(d);}const r=http.request({hostname:'127.0.0.1',port:3335,path:'/api'+path,method,headers:h},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(b||'{}')}));});r.on('error',reject);if(d)r.write(d);r.end();});}
(async()=>{const out={};const login=await req('POST','/auth/login',{username:'diego',password:'9322'});const token=login.body.token;const cobApi=await req('GET','/cobros/pending-summary/093',null,token);out.apiCobros093={grandTotal:cobApi.body.grandTotal,clientCount:cobApi.body.clientCount,source:cobApi.body.source};
const conn=await odbc.connect(cs());const vendor='93';
const scoped=await conn.query(`SELECT COALESCE(SUM(CVC.IMPORTEPENDIENTE),0) AS GT FROM DSEDAC.CVC CVC WHERE CVC.IMPORTEPENDIENTE<>0 AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN<>'S') AND EXISTS (SELECT 1 FROM DSEDAC.CLP CLP WHERE TRIM(CLP.CODIGOCLIENTE)=TRIM(CVC.CODIGOCLIENTEALBARAN) AND TRIM(CLP.VENDEDORCOMERCIAL)=?)`,[vendor]);out.db2CobrosScoped93=Number(scoped[0].GT);
const all=await conn.query(`SELECT COALESCE(SUM(IMPORTEPENDIENTE),0) AS T FROM DSEDAC.CVC WHERE IMPORTEPENDIENTE<>0 AND (ANULADOSN IS NULL OR ANULADOSN<>'S')`);out.db2CvcAllVendors=Number(all[0].T);
const clpEmpty=await conn.query(`SELECT COUNT(*) AS C FROM DSEDAC.CLP WHERE TRIM(COALESCE(VENDEDORCOMERCIAL,''))=''`);out.clpEmptyVendorRows=Number(clpEmpty[0].C);
const bolsaDup=await conn.query(`SELECT TRIM(CODIGOVENDEDOR) V,EJERCICIO,MES,COUNT(*) C FROM JAVIER.BOLSA_COMERCIAL GROUP BY TRIM(CODIGOVENDEDOR),EJERCICIO,MES HAVING COUNT(*)>1`);out.bolsaDuplicateGroups=bolsaDup.length;
const bolsa93=await conn.query(`SELECT SALDO_DISPONIBLE,CONSUMIDO,ACUMULADO FROM JAVIER.BOLSA_COMERCIAL WHERE TRIM(CODIGOVENDEDOR)=? AND EJERCICIO=YEAR(CURRENT_DATE) AND MES=MONTH(CURRENT_DATE) FETCH FIRST 1 ROW ONLY`,[vendor]);out.db2Bolsa93=bolsa93[0]||null;
const bolsaApi=await req('GET','/bolsa/093/status',null,token);out.apiBolsa093=bolsaApi.body.bolsa;
const p87=await conn.query(`SELECT ID,TERMINAL,TERMINALPEDIDO,NUMEROPEDIDO,SERIEPEDIDO,TRIM(CODIGOVENDEDOR) V,SYNC_STATUS,EJERCICIOPEDIDO FROM JAVIER.PEDIDOS_CAB WHERE ID=87`);out.db2Pedido87=p87[0]||null;
const clients=await req('GET','/clients/list?vendedorCodes=93&limit=1',null,token);const clientCode=clients.body.clients?.[0]?.code;out.sampleClient=clientCode;
if(clientCode){const promApi=await req('GET',`/pedidos/promotions?clientCode=${encodeURIComponent(clientCode)}&vendedorCode=093`,null,token);out.promotionsApiCount=(promApi.body.promotions||[]).length;
const prods=await req('GET',`/pedidos/products?vendedorCode=093&clientCode=${encodeURIComponent(clientCode)}&limit=3`,null,token);const prod=(prods.body.products||[])[0];
if(prod){const idem='mandato-v5-'+Date.now();const create=await req('POST','/pedidos/create',{clientCode,clientName:clients.body.clients[0].name,vendedorCode:'093',lines:[{codigoArticulo:prod.code||prod.codigoArticulo,descripcion:prod.name||'t',cantidadEnvases:1,precio:Number(prod.price||prod.precio||1),precioCosto:0.5}]},token,{'Idempotency-Key':idem});
const oid=create.body.order?.id||create.body.order?.header?.id;out.create={status:create.status,oid,error:create.body.error,code:create.body.code};
if(oid){const conf=await req('PUT',`/pedidos/${oid}/confirm`,{saleType:'CC'},token);out.confirm={status:conf.status,error:conf.body?.error};
const det=await req('GET',`/pedidos/${oid}`,null,token);const h=det.body.order?.header||{};out.testPedidoApi={id:oid,terminal:h.terminal,serie:h.serie,numeroPedido:h.numeroPedido,vendedor:h.vendedor,estado:h.estado};
const dbp=await conn.query(`SELECT ID,TERMINAL,TERMINALPEDIDO,NUMEROPEDIDO,SERIEPEDIDO,TRIM(CODIGOVENDEDOR) V,SYNC_STATUS FROM JAVIER.PEDIDOS_CAB WHERE ID=?`,[oid]);out.testPedidoDb2=dbp[0];
const term=dbp[0].TERMINALPEDIDO??dbp[0].TERMINAL;out.formattedExpected='P-'+String(term).padStart(3,'0')+'-'+String(dbp[0].NUMEROPEDIDO).padStart(6,'0');
const cpc=await conn.query(`SELECT COUNT(*) AS C FROM DSEDAC.CPC WHERE EJERCICIOPEDIDO=? AND TRIM(SERIEPEDIDO)=? AND TERMINALPEDIDO=? AND NUMEROPEDIDO=?`,[2026,'P',term,dbp[0].NUMEROPEDIDO]);out.dsedacCpcRows=Number(cpc[0].C);}}}
await conn.close();console.log(JSON.stringify(out,null,2));})().catch(e=>{console.error(e);process.exit(1);});
