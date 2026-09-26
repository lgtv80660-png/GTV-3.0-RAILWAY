import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { POST as loginPOST } from "../login/route";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(){try{const c=await requireSession();return NextResponse.json({authenticated:true,baseUrl:c.serverUrl,username:c.username});}catch{return NextResponse.json({authenticated:false},{status:401});}}
export async function POST(req:NextRequest){return loginPOST(req);}
export async function DELETE(){const r=NextResponse.json({ok:true}); r.cookies.set("gtv_session","",{path:"/",maxAge:0,httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production"}); return r;}
