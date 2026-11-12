// A minimal PDF writer: every page is one JPEG picture (the report pages are drawn on a canvas
// with the device's own fonts, so any script renders; decided with the owner, PLAN-mobile stage 3).
// No dependencies; works in the browser and in Node (tests/pwa_unit.cjs).
//
//   pdfFromJpegs([{ jpeg: Uint8Array, w: px, h: px }], { title, creator, pageW: pt, pageH: pt }) -> Uint8Array

const enc = new TextEncoder();

// A PDF text string that holds any Unicode: UTF-16BE with a BOM, as a hex string.
function pdfText(s){
  let hex = "FEFF";
  const h4 = (n) => n.toString(16).toUpperCase().padStart(4, "0");
  for (const ch of String(s == null ? "" : s)){
    const cp = ch.codePointAt(0);
    if (cp > 0xffff){ const v = cp - 0x10000; hex += h4(0xd800 + (v >> 10)) + h4(0xdc00 + (v & 0x3ff)); }
    else hex += h4(cp);
  }
  return "<" + hex + ">";
}

function pdfDate(d){
  const p = (n) => String(n).padStart(2, "0");
  return `(D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z)`;
}

export function pdfFromJpegs(pages, opts = {}){
  const W = opts.pageW || 595, H = opts.pageH || 842;
  const parts = [], offsets = [];
  let len = 0;
  const put = (x) => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n, body) => { offsets[n] = len; put(`${n} 0 obj\n`); body(); put("\nendobj\n"); };

  put("%PDF-1.4\n");
  put(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));  // binary marker comment
  const n = pages.length, first = 4;
  const kids = pages.map((_, i) => `${first + i * 3} 0 R`).join(" ");
  obj(1, () => put("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => put(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`));
  obj(3, () => put(`<< /Title ${pdfText(opts.title || "Review")} /Creator ${pdfText(opts.creator || "Sight Review")} /Producer ${pdfText("Sight Review")} /CreationDate ${pdfDate(opts.date || new Date())} >>`));
  pages.forEach((pg, i) => {
    const pn = first + i * 3, cn = pn + 1, im = pn + 2;
    obj(pn, () => put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${cn} 0 R >>`));
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(cn, () => { put(`<< /Length ${content.length} >>\nstream\n`); put(content); put("\nendstream"); });
    obj(im, () => {
      put(`<< /Type /XObject /Subtype /Image /Width ${pg.w | 0} /Height ${pg.h | 0} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`);
      put(pg.jpeg); put("\nendstream");
    });
  });
  const total = first + n * 3;
  const xref = len;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  put(x);
  put(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts){ out.set(p, o); o += p.length; }
  return out;
}
