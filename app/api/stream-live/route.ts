import { NextRequest } from "next/server";
import { GET as hlsGET } from "../hls/route";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(req:NextRequest){const u=new URL(req.url); const target=new URL("/api/hls",u.origin); u.searchParams.forEach((v,k)=>target.searchParams.set(k,v)); return hlsGET(new NextRequest(target,{headers:req.headers}));}
