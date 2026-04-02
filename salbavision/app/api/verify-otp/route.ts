import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const { email, otp } = await req.json();
    if (!email || !otp) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    const supabase = await createClient();
    const { data: otpRows, error: otpError } = await supabase
      .from("password_resets")
      .select("otp, expires_at")
      .eq("email", email)
      .order("expires_at", { ascending: false })
      .limit(1);
    if (otpError) throw otpError;
    if (!otpRows || otpRows.length === 0) {
      return NextResponse.json({ error: "OTP not found. Please request a new code." }, { status: 400 });
    }
    const otpRow = otpRows[0];
    if (otpRow.otp !== otp) {
      return NextResponse.json({ error: "Invalid OTP. Please check the code sent to your email." }, { status: 400 });
    }
    if (otpRow.expires_at && new Date(otpRow.expires_at) < new Date()) {
      await supabase.from("password_resets").delete().eq("email", email);
      return NextResponse.json({ error: "OTP expired. Please request a new code." }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Unknown error" }, { status: 500 });
  }
}
