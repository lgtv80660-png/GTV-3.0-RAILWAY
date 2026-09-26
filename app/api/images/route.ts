import { NextRequest } from "next/server";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(req: NextRequest) {
  const raw=req.nextUrl.searchParams.get("url");
  if(!raw) return new Response("Missing url",{status:400});
  let url:URL; try{url=new URL(raw);}catch{return new Response("Invalid url",{status:400});}
  if(!["http:","https:"].includes(url.protocol)) return new Response("Invalid protocol",{status:400});
  try{
    const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0 GTV/3.0","Accept":"image/*"},redirect:"follow",cache:"no-store"});
    if(!r.ok) return new Response("Image upstream error",{status:r.status});
    const h=new Headers(); h.set("Content-Type",r.headers.get("content-type")||"image/jpeg"); h.set("Cache-Control","public, max-age=86400");
    return new Response(r.body,{status:200,headers:h});
  }catch{return new Response("Image unavailable",{status:502});}
}
