import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { sendGmail } from "@/lib/send-gmail";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: "Missing email" }, { status: 400 });
    }

    const supabase = await createClient();

    // Check if user exists
    const { data: users, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .limit(1);
    if (userError) throw userError;
    if (!users || users.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    // OTP expires in 1 minute
    const expiresAt = new Date(Date.now() + 1 * 60 * 1000).toISOString(); // 1 minute

    // Store OTP in password_resets table
    await supabase.from("password_resets").upsert([
      { email, otp, expires_at: expiresAt },
    ], { onConflict: "email" });


    // Send OTP via Gmail
    await sendGmail(
      email,
      "Your Password Reset OTP",
      `Your OTP code is: ${otp}\nThis code will expire in 1 minute.`
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Unknown error" }, { status: 500 });
  }
}
