const axios = require('axios');
const BASE = 'http://192.168.1.191/movilidad/ImagenesGestorDocumentalNuevo';
const EXTS = ['png','jpg','jpeg','gif','bmp','webp'];

async function check(code) {
  try {
    const r = await axios.get(`${BASE}/${code}/`, { timeout: 5000, responseType: 'text' });
    const links = [];
    const regex = /<a\s+href="([^"]+)"[^>]*>/gi;
    let m;
    while ((m = regex.exec(r.data)) !== null) {
      const h = m[1];
      if (h && !h.startsWith('/') && !h.startsWith('?') && h !== '../') {
        try { links.push(decodeURIComponent(h)); } catch(e) { links.push(h); }
      }
    }
    const imgs = links.filter(f => !f.endsWith('/') && EXTS.includes(f.split('.').pop().toLowerCase()));
    const dirs = links.filter(f => f.endsWith('/'));
    const hasFotos = dirs.some(d => d.toUpperCase().startsWith('FOTO'));
    console.log(`${code}: rootImgs=${imgs.length} [${imgs.join(', ')}] hasFotosDir=${hasFotos}`);
    
    // If no root images but has FOTOS dir, check inside
    if (imgs.length === 0 && hasFotos) {
      const fotosDir = dirs.find(d => d.toUpperCase().startsWith('FOTO'));
      const r2 = await axios.get(`${BASE}/${code}/${encodeURIComponent(fotosDir.replace(/\/$/,''))}/`, { timeout: 5000, responseType: 'text' });
      const subLinks = [];
      let m2;
      const regex2 = /<a\s+href="([^"]+)"[^>]*>/gi;
      while ((m2 = regex2.exec(r2.data)) !== null) {
        const h = m2[1];
        if (h && !h.startsWith('/') && !h.startsWith('?') && h !== '../') {
          try { subLinks.push(decodeURIComponent(h)); } catch(e) { subLinks.push(h); }
        }
      }
      const subImgs = subLinks.filter(f => !f.endsWith('/') && EXTS.includes(f.split('.').pop().toLowerCase()));
      console.log(`  -> FOTOS/ has ${subImgs.length} images: [${subImgs.join(', ')}]`);
    }
  } catch(e) {
    console.log(`${code}: ERROR ${e.response ? e.response.status : e.code}`);
  }
}

(async () => {
  const codes = ['8200','1384','1965','1415','2450','8100','8150','1000','1010','1050','1100','2000','2100','3000','4000','5000','6000','7000'];
  for (const c of codes) await check(c);
})();
