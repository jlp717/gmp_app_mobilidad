require('dotenv').config({path:require('path').join(__dirname,'../.env')});
const http=require('http');const UA='GMP-Mandato-V5/1.0';
const { getProbeCredentials } = require('./probe-credentials');
function get(p,t){return new Promise(r=>{http.get({hostname:'127.0.0.1',port:3335,path:'/api'+p,headers:{'User-Agent':UA,Authorization:'Bearer '+t}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>r(JSON.parse(b)));});});}
function post(p,b){return new Promise(r=>{const d=JSON.stringify(b);const q=http.request({hostname:'127.0.0.1',port:3335,path:'/api'+p,method:'POST',headers:{'User-Agent':UA,'Content-Type':'application/json','Content-Length':d.length}},res=>{let x='';res.on('data',c=>x+=c);res.on('end',()=>r(JSON.parse(x)));});q.write(d);q.end();});}
(async()=>{const l=await post('/auth/login',getProbeCredentials('mandato v5 check orders'));const t=l.token;
for(const id of [88,89,90]){const d=await get('/pedidos/'+id,t);const h=d.order?.header||{};if(h.id)console.log(id,JSON.stringify({terminal:h.terminal,vend:h.vendedor,serie:h.serie,numero:h.numeroPedido,estado:h.estado}));}})();
