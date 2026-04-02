
"use client";
import React from "react";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export function ForgotPasswordForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [step, setStep] = useState<"email" | "otp" | "reset">("email");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [otpTimer, setOtpTimer] = React.useState(0); // seconds left for OTP validity
  // Timer for OTP resend cooldown
  React.useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  // OTP validity timer (1 minute)
  React.useEffect(() => {
    if (step === "otp" && otpTimer > 0) {
      const timer = setTimeout(() => setOtpTimer(otpTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [otpTimer, step]);



  // Step 1: Send OTP to email
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cooldown > 0) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send OTP");
      toast.success("OTP sent to your email");
      setStep("otp");
      setCooldown(60); // 60 seconds cooldown
      setOtpTimer(60); // 60 seconds OTP validity
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2: Verify OTP server-side before allowing password reset
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otpTimer <= 0) {
      setError("OTP expired. Please request a new code.");
      return;
    }
    setIsLoading(true);
    setError(null);
    if (!otp || otp.length < 4) {
      setError("Please enter the OTP code sent to your email.");
      setIsLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "OTP verification failed");
      toast.success("OTP verified! Proceed to password reset.");
      setStep("reset");
      setError(null);
      setOtpTimer(0); // CLEAR TIMER - hindi na gamitin sa reset step
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Step 3: Reset password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    if (!otp) {
      setError("OTP is required.");
      setIsLoading(false);
      return;
    }
    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      setIsLoading(false);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
      return;
    }
    try {
      // OTP is verified server-side. If invalid, error will be shown.
      const res = await fetch("/api/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reset password");
      toast.success("Password reset successful!");
      setTimeout(() => {
        router.replace("/auth/login");
      }, 1500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      {step === "email" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Reset Your Password</CardTitle>
            <CardDescription>
              Enter your email and we&apos;ll send you an OTP code
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSendOtp}>
              <div className="flex flex-col gap-6">
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="m@example.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                {error && <p className="text-sm text-red-500">{error}</p>}
                <Button type="submit" className="w-full" disabled={isLoading || cooldown > 0}>
                  {isLoading ? "Sending..." : cooldown > 0 ? `Resend OTP (${cooldown})` : "Send OTP"}
                </Button>
              </div>
              <div className="mt-4 text-center text-sm">
                Already have an account?{" "}
                <Link
                  href="/auth/login"
                  className="underline-offset-4 hover:underline"
                >
                  Login
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
      {step === "otp" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Enter OTP</CardTitle>
            <CardDescription>
              We sent a code to <span className="font-semibold">{email}</span>
              <br />
              <span className="text-xs text-gray-500">
                OTP expires in: {otpTimer > 0 ? `${otpTimer}s` : "Expired"}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleVerifyOtp}>
              <div className="flex flex-col gap-6">
                <div className="grid gap-2">
                  <Label htmlFor="otp">OTP Code</Label>
                  <Input
                    id="otp"
                    type="text"
                    placeholder="Enter OTP"
                    required
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    disabled={otpTimer <= 0}
                  />
                </div>
                {error && otpTimer > 0 && <p className="text-sm text-red-500">{error}</p>}
                {otpTimer <= 0 && !isLoading && <p className="text-sm text-red-500">OTP expired. Please request a new code.</p>}
                {otpTimer > 0 && (
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? "Verifying..." : "Verify OTP"}
                  </Button>
                )}
                {otpTimer <= 0 && (
                  <Button
                    type="button"
                    className="w-full"
                    disabled={isLoading}
                    onClick={async () => {
                      setIsLoading(true);
                      setError(null);
                      try {
                        const res = await fetch("/api/send-otp", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ email }),
                        });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error || "Failed to send OTP");
                        toast.success("New OTP sent to your email");
                        setOtp("");
                        setOtpTimer(60);
                      } catch (err: any) {
                        setError(err.message);
                      } finally {
                        setIsLoading(false);
                      }
                    }}
                  >
                    {isLoading ? "Sending..." : "Request New OTP"}
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      )}
      {step === "reset" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Set New Password</CardTitle>
            <CardDescription>
              Enter your new password for <span className="font-semibold">{email}</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleResetPassword}>
              <div className="flex flex-col gap-6">
                <div className="grid gap-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="New password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="confirm-password">Confirm Password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="Confirm password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
                {error && <p className="text-sm text-red-500">{error}</p>}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? "Resetting..." : "Reset Password"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
