import { NextRequest } from "next/server";
import { GET as footballTodayGET } from "../../football/today/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return footballTodayGET(request);
}
