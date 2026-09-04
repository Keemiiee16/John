import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";
import { esc, nova } from "./utils.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here);

function svg(width, height, lines) {
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  ${lines.map(x => `<text x="${x.x}" y="${x.y}" text-anchor="${x.anchor || "start"}"
    font-family="Arial,Helvetica,sans-serif" font-size="${x.size || 36}"
    font-weight="${x.weight || 700}" fill="${x.fill || "#ffffff"}">${esc(x.text)}</text>`).join("\n")}
  </svg>`);
}

export async function renderEquityTransaction({
  transactionType,
  amountVoro,
  date,
  time,
  account,
  reference,
  status,
  memo,
  availableBalanceVoro
}) {
  const file = path.join(assets, "equity_financial_transaction_template.png");
  const meta = await sharp(file).metadata();
  const w = meta.width, h = meta.height;

  // Coordinates are intentionally kept in one place so they can be nudged after a visual test.
  const layer = svg(w, h, [
    {x:w*.64,y:h*.338,text:transactionType,size:w*.021},
    {x:w*.64,y:h*.389,text:nova(amountVoro),size:w*.021},
    {x:w*.64,y:h*.442,text:date,size:w*.020},
    {x:w*.64,y:h*.494,text:time,size:w*.020},
    {x:w*.64,y:h*.548,text:account,size:w*.020},
    {x:w*.64,y:h*.600,text:reference,size:w*.017},
    {x:w*.64,y:h*.652,text:status,size:w*.020},
    {x:w*.64,y:h*.704,text:memo || "—",size:w*.018},
    {x:w*.64,y:h*.756,text:nova(availableBalanceVoro),size:w*.020}
  ]);

  return sharp(file).composite([{ input: layer, left: 0, top: 0 }]).png().toBuffer();
}

export async function renderPartTicket({
  passenger,
  transitType,
  ticketType,
  route,
  departure,
  arrival,
  date,
  time,
  fareVoro,
  ticketId,
  status = "BOOKED"
}) {
  const file = path.join(assets, "part_trip_booked_template.png");
  const meta = await sharp(file).metadata();
  const w = meta.width, h = meta.height;
  const lines = [
    {x:w*.18,y:h*.337,text:passenger,size:w*.018,fill:"#082a59"},
    {x:w*.59,y:h*.337,text:transitType,size:w*.018,fill:"#082a59"},
    {x:w*.18,y:h*.413,text:ticketType,size:w*.018,fill:"#082a59"},
    {x:w*.59,y:h*.413,text:route || "PAR-T",size:w*.018,fill:"#082a59"},
    {x:w*.18,y:h*.503,text:departure || "—",size:w*.017,fill:"#082a59"},
    {x:w*.18,y:h*.558,text:arrival || "—",size:w*.017,fill:"#082a59"},
    {x:w*.59,y:h*.503,text:date,size:w*.017,fill:"#082a59"},
    {x:w*.59,y:h*.558,text:time,size:w*.017,fill:"#082a59"},
    {x:w*.18,y:h*.642,text:nova(fareVoro),size:w*.019,fill:"#082a59"},
    {x:w*.43,y:h*.642,text:ticketId,size:w*.016,fill:"#082a59"},
    {x:w*.69,y:h*.642,text:status,size:w*.017,fill:"#082a59"}
  ];
  return sharp(file).composite([{ input: svg(w,h,lines), left:0, top:0 }]).png().toBuffer();
}
