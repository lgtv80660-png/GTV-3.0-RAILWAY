import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
  try{const c=await requireSession(); const id=req.nextUrl.searchParams.get("stream_id"); const limit=req.nextUrl.searchParams.get("limit")||"8"; if(!id)return NextResponse.json({error:"Missing stream_id"},{status:400});
  const sp=new URLSearchParams({username:c.username,password:c.password,action:"get_short_epg",stream_id:id,limit}); const r=await fetch(`${c.serverUrl.replace(/\/+$/,'')}/player_api.php?${sp}`,{cache:"no-store"}); const body=await r.text(); return new Response(body,{status:r.status,headers:{"Content-Type":r.headers.get("content-type")||"application/json","Cache-Control":"no-store"}});
  }catch{return NextResponse.json({error:"Unauthorized"},{status:401});}}
