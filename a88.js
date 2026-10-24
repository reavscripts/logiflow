import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import fs from 'node:fs/promises';

export async function generateA88(containers,reference='') {
 const doc=await PDFDocument.create();
 const header=await doc.embedPng(await fs.readFile(new URL('./assets/a88-header.png',import.meta.url)));
 const font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 const perPage=18,total=Math.ceil(containers.length/perPage);
 for(let offset=0;offset<containers.length;offset+=perPage){
  const page=doc.addPage([595.28,841.89]);page.drawImage(header,{x:0,y:456.89,width:595.28,height:385});
  if(reference)page.drawText(reference,{x:118,y:562,size:10,font});
  const x=[66,108,270,405,541],top=448,row=20,rows=19;
  for(let r=0;r<=rows;r++)page.drawLine({start:{x:x[0],y:top-r*row},end:{x:x[4],y:top-r*row},thickness:.6,color:rgb(0,0,0)});
  for(const col of x)page.drawLine({start:{x:col,y:top},end:{x:col,y:top-rows*row},thickness:.6});
  ['N.','CONTENITORE','DATA USCITA','FIRMA'].forEach((text,i)=>page.drawText(text,{x:x[i]+6,y:top-14,font:bold,size:9}));
  containers.slice(offset,offset+perPage).forEach((code,i)=>{const y=top-(i+1)*row-14;page.drawText(String(offset+i+1),{x:x[0]+8,y,font,size:10});page.drawText(code,{x:x[1]+8,y,font:bold,size:11});});
  page.drawText(`Pagina ${offset/perPage+1} di ${total}`,{x:470,y:45,font,size:9});
 }
 return Buffer.from(await doc.save());
}
