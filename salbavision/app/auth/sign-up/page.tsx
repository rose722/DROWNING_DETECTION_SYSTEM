"use client";
import { SignUpForm } from "@/components/sign-up-form";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Page() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window !== "undefined") {
      if (localStorage.getItem("isLoggedIn") === "true") {
        window.location.replace("/dashboard/admin");
      }
    }
    // Listen for browser back/forward navigation
    const handlePopState = () => {
      if (localStorage.getItem("isLoggedIn") === "true") {
        window.location.replace("/dashboard/admin");
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [router]);

  return (
    <div className="login-bg">
      <div className="bubbles" />
      <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10 relative z-10">
        <div className="w-full max-w-sm">
          <SignUpForm />
        </div>
      </div>
    </div>
  );
}
