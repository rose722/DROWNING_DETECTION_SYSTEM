"use client";
import { LoginForm } from "@/components/login-form";

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
      {/* Back to Home Button */}
      <a
        href="/"
        className="fixed left-6 top-6 z-20 px-5 py-2 rounded-lg bg-white/80 hover:bg-blue-100 text-blue-900 font-bold shadow-lg border-2 border-blue-300 transition-all duration-150 flex items-center gap-2"
        style={{ textDecoration: 'none' }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
        Back to Home
      </a>
        <div className="w-full max-w-sm">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
