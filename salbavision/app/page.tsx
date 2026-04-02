"use client";
import { DeployButton } from "@/components/deploy-button";
import { EnvVarWarning } from "@/components/env-var-warning";
// import { AuthButton } from "@/components/auth-button";
import { Hero } from "@/components/hero";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { ConnectSupabaseSteps } from "@/components/tutorial/connect-supabase-steps";
import { SignUpUserSteps } from "@/components/tutorial/sign-up-user-steps";
import { hasEnvVars } from "@/lib/utils";
import Link from "next/link";
import { Suspense } from "react";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
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
    <main className="min-h-screen flex flex-col items-center">
        <div className="flex-1 w-full flex flex-col gap-20 items-center">
          <nav className="w-full flex justify-center border-b border-b-foreground/10 h-16 bg-white text-black dark:bg-black dark:text-white">
            <div className="w-full max-w-5xl flex justify-between items-center p-3 px-5 text-sm">
              <div className="flex gap-5 items-center text-xl font-bold text-black dark:text-white">
                <p>SALBAVISION</p>
              </div>
              {!hasEnvVars ? (
                <EnvVarWarning />
              ) : (
                <div className="flex gap-2">
                  <Link href="/auth/login">
                    <button className="px-3 py-1 border rounded bg-white hover:bg-neutral-200 text-black text-sm shadow dark:bg-black dark:hover:bg-neutral-800 dark:text-white">Log in</button>
                  </Link>
                  <Link href="/auth/sign-up">
                    <button className="px-3 py-1 border rounded bg-black hover:bg-neutral-800 text-white text-sm shadow dark:bg-white dark:hover:bg-neutral-200 dark:text-black">Sign up</button>
                  </Link>
                </div>
              )}
            </div>
          </nav>
          <div className="flex-1 flex flex-col gap-20 max-w-5xl p-5">
            <Hero />
            <main className="flex-1 flex flex-col gap-6 px-4">
              <h2 className="font-medium text-xl mb-4">Next steps</h2>
              {hasEnvVars ? <SignUpUserSteps /> : <ConnectSupabaseSteps />}
            </main>
          </div>

          <footer className="w-full flex items-center justify-center border-t border-foreground/10 bg-white text-black dark:bg-black dark:text-white mx-auto text-center text-xs gap-8 py-16">
            <p className="font-semibold">
              © 2025 Cavite State University - Bacoor Campus | Smart Drowning Detection System
            </p>
            <ThemeSwitcher />
          </footer>
        </div>
        </main>
  );
}
