import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness check: the app is up and serving routes. */
export function GET() {
  return NextResponse.json({ status: "ok", app: "the-reserve", time: new Date().toISOString() });
}
