import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";
import { escapeXml, nova } from "./utils.js";
const here=path.dirname(fileURLToPath(import.meta.url));
const ASSETS=here;
function svg(w,h,lines){
  return Buffer.from(`<svg width="${w}" height="${h}">${lines.map(x=>`<text x="${x.x}" y="${x.y}" text-anchor="${x.anchor||"start"}" font-family="Arial, sans-serif" font-size="${x.size||40}" font-weight="${x.weight||700}" fill="${x.fill||"#fff"}">${escapeXml(x.text??"")}</text>`).join("")}</svg>`);
}
export async function vyltReceipt(d){
  const f=path.join(ASSETS,"vylt_receipt_template.png"), m=await sharp(f).metadata(), w=m.width,h=m.height;
  const o=svg(w,h,[
    {x:w*.50,y:h*.37,anchor:"middle",text:nova(d.amountVoro),size:w*.09,fill:"#e9ff62"},
    {x:w*.63,y:h*.58,text:d.from,size:w*.03},{x:w*.63,y:h*.63,text:d.to,size:w*.03},
    {x:w*.63,y:h*.68,text:d.note||"—",size:w*.028},{x:w*.63,y:h*.73,text:d.date,size:w*.026},
    {x:w*.63,y:h*.78,text:d.transactionId,size:w*.026}
  ]);
  return sharp(f).composite([{input:o,top:0,left:0}]).png().toBuffer();
}
export async function nabitReceipt(d){
  const f=path.join(ASSETS,"nabit_receipt_template.png"),m=await sharp(f).metadata(),w=m.width,h=m.height;
  const items=(d.items||[]).slice(0,4).map(i=>`${i.quantity||1}x ${i.item_name||i.name}`).join(" • ")||"Order";
  const o=svg(w,h,[
    {x:w*.12,y:h*.23,text:d.status||"CONFIRMED",size:w*.04},
    {x:w*.84,y:h*.23,anchor:"end",text:`${d.etaMinutes??20} min`,size:w*.034,fill:"#e9ff62"},
    {x:w*.20,y:h*.49,text:d.recipient||"",size:w*.028},{x:w*.20,y:h*.54,text:d.business||"",size:w*.028},
    {x:w*.12,y:h*.66,text:items,size:w*.023},
    {x:w*.12,y:h*.79,text:`Subtotal ${nova(d.subtotalVoro)}  Fee ${nova(d.deliveryFeeVoro)}  Tax ${nova(d.taxVoro)}`,size:w*.020},
    {x:w*.12,y:h*.84,text:`TOTAL ${nova(d.totalVoro)}`,size:w*.036,fill:"#e9ff62"},
    {x:w*.12,y:h*.90,text:`${d.orderId||""} • ${d.date||""}`,size:w*.019}
  ]);
  return sharp(f).composite([{input:o,top:0,left:0}]).png().toBuffer();
}
export async function vybeReceipt(d){
  const f=path.join(ASSETS,"vybe_driver_template.png"),m=await sharp(f).metadata(),w=m.width,h=m.height;
  const o=svg(w,h,[
    {x:w*.17,y:h*.74,text:`${d.etaMinutes??7} min away`,size:w*.03},
    {x:w*.17,y:h*.80,text:`${d.rideType||"VYBE"} • ${d.destination||"Destination"}`,size:w*.024},
    {x:w*.17,y:h*.86,text:`${nova(d.fareVoro)} • ${d.tripId||""}`,size:w*.021}
  ]);
  return sharp(f).composite([{input:o,top:0,left:0}]).png().toBuffer();
}
export async function vantageReceipt(d){
  const f=path.join(ASSETS,"vantage_order_template.png"),m=await sharp(f).metadata(),w=m.width,h=m.height;
  const o=svg(w,h,[
    {x:w*.12,y:h*.33,text:`Order #${d.orderNumber||""}`,size:w*.031},
    {x:w*.12,y:h*.39,text:`Arriving: ${d.arrival||""}`,size:w*.029,fill:"#e9ff62"},
    {x:w*.12,y:h*.45,text:`For: ${d.recipient||"Your character"}`,size:w*.027},
    {x:w*.12,y:h*.51,text:`Status: ${d.status||"Confirmed"}`,size:w*.027}
  ]);
  return sharp(f).composite([{input:o,top:0,left:0}]).png().toBuffer();
}
export async function partReceipt(d){
  const f=path.join(ASSETS,"part_ticket_template.png"),m=await sharp(f).metadata(),w=m.width,h=m.height;
  const o=svg(w,h,[
    {x:w*.18,y:h*.37,text:d.passenger||"",size:w*.027,fill:"#0a2c63"},
    {x:w*.64,y:h*.37,text:d.transitType||"",size:w*.027,fill:"#0a2c63"},
    {x:w*.18,y:h*.44,text:d.ticketType||"",size:w*.026,fill:"#0a2c63"},
    {x:w*.64,y:h*.44,text:d.routeLine||"PAR-T",size:w*.026,fill:"#0a2c63"},
    {x:w*.18,y:h*.53,text:d.departure||"—",size:w*.025,fill:"#0a2c63"},
    {x:w*.18,y:h*.60,text:d.arrival||"—",size:w*.025,fill:"#0a2c63"},
    {x:w*.64,y:h*.53,text:d.date||"",size:w*.024,fill:"#0a2c63"},
    {x:w*.64,y:h*.60,text:d.time||"",size:w*.024,fill:"#0a2c63"},
    {x:w*.18,y:h*.69,text:nova(d.fareVoro),size:w*.026,fill:"#0a2c63"},
    {x:w*.47,y:h*.69,text:d.ticketId||"",size:w*.022,fill:"#0a2c63"},
    {x:w*.76,y:h*.69,text:d.status||"BOOKED",size:w*.022,fill:"#0a2c63"}
  ]);
  return sharp(f).composite([{input:o,top:0,left:0}]).png().toBuffer();
}