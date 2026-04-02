import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  try {
    const { email, otp, newPassword } = await req.json();
    if (!email || !otp || !newPassword) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const supabase = await createClient();

    // 1. Find the OTP record for this email
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
    // OTP expiration is already checked during verify-otp step, no need to check again here

    // 2. Hash the new password
    const hashedPassword = bcrypt.hashSync(newPassword, 10);

    // 3. Update the user's password in the users table
    const { error: updateError } = await supabase
      .from("users")
      .update({ password: hashedPassword })
      .eq("email", email);
    if (updateError) {
      return NextResponse.json({ error: "Failed to update password. Please try again." }, { status: 500 });
    }

    // 4. Delete the OTP record after successful reset
    await supabase.from("password_resets").delete().eq("email", email);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Unknown error" }, { status: 500 });
  }
}
