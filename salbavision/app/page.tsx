"use client";
import { EnvVarWarning } from "@/components/env-var-warning";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { hasEnvVars } from "@/lib/utils";
import Link from "next/link";

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
    <main className="landing-shell min-h-screen">
      <div className="landing-grid" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-8 pt-4 sm:px-6 lg:px-8">
        <nav className="landing-nav reveal-up" style={{ animationDelay: "0.05s" }}>
          <div className="flex items-center gap-3">
            <div className="pulse-dot" aria-hidden="true" />
            <div>
              <p className="tracking-[0.18em] text-xs text-sky-100/85">SALBAVISION</p>
              <p className="text-xs text-sky-100/60">AI Safety Monitoring Platform</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {!hasEnvVars ? (
              <EnvVarWarning />
            ) : (
              <>
                <Link href="/auth/login" className="landing-btn landing-btn-ghost">
                  Log in
                </Link>
                <Link href="/auth/sign-up" className="landing-btn landing-btn-solid">
                  Sign up
                </Link>
              </>
            )}
            <ThemeSwitcher />
          </div>
        </nav>

        <section className="mt-10 grid gap-6 lg:mt-16 lg:grid-cols-[1.2fr_0.8fr] lg:gap-8">
          <article className="landing-card reveal-up" style={{ animationDelay: "0.1s" }}>
            <p className="landing-chip">Research-Based Capstone System</p>
            <h1 className="mt-4 text-3xl font-semibold leading-tight text-white sm:text-4xl lg:text-5xl">
              Smart Surveillance Drowning Detection and Alert System for Faster Lifesaving Response
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-sky-50/85 sm:text-base">
              Salbavision is designed to reduce delayed emergency response in swimming areas by combining CCTV,
              real-time AI detection, immediate siren activation, and dashboard alerts. The system aligns with
              Chapter 1 research goals: early risk detection, rapid notification, and improved water safety monitoring.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link href="/dashboard/admin/detection" className="landing-btn landing-btn-solid">
                Open Live Detection
              </Link>
              <Link href="/auth/login" className="landing-btn landing-btn-ghost">
                Admin Access
              </Link>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <div className="stat-pill">
                <p className="stat-label">Input Layer</p>
                <p className="stat-value">RTSP CCTV Feed</p>
              </div>
              <div className="stat-pill">
                <p className="stat-label">AI Core</p>
                <p className="stat-value">Real-time Detection</p>
              </div>
              <div className="stat-pill">
                <p className="stat-label">Output</p>
                <p className="stat-value">Alert + Siren + Logs</p>
              </div>
            </div>
          </article>

          <aside className="landing-card reveal-up" style={{ animationDelay: "0.2s" }}>
            <p className="text-xs uppercase tracking-[0.22em] text-sky-100/70">Chapter 1 Focus</p>
            <div className="mt-4 space-y-4">
              <div className="focus-item">
                <h3>Problem Statement</h3>
                <p>Manual monitoring can miss critical drowning events due to delayed visual confirmation.</p>
              </div>
              <div className="focus-item">
                <h3>General Objective</h3>
                <p>Develop an AI-assisted surveillance system that continuously identifies possible drowning incidents.</p>
              </div>
              <div className="focus-item">
                <h3>Specific Objectives</h3>
                <p>Detect risk states, trigger alarms instantly, and record incidents for post-event analysis.</p>
              </div>
              <div className="focus-item">
                <h3>Scope & Delimitation</h3>
                <p>Focused on configured CCTV zones, supported model classes, and dashboard-assisted monitoring.</p>
              </div>
            </div>
          </aside>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-3">
          <article className="landing-card reveal-up" style={{ animationDelay: "0.25s" }}>
            <h2 className="section-title">System Workflow</h2>
            <p className="section-copy">
              CCTV frames are processed by AI detection scripts, then streamed to the dashboard with class overlays for
              drowning, swimming, and out-of-water states.
            </p>
          </article>
          <article className="landing-card reveal-up" style={{ animationDelay: "0.3s" }}>
            <h2 className="section-title">Alert Mechanism</h2>
            <p className="section-copy">
              When sustained drowning behavior is confirmed, the system activates the siren and logs an incident record
              to support real-time response and documentation.
            </p>
          </article>
          <article className="landing-card reveal-up" style={{ animationDelay: "0.35s" }}>
            <h2 className="section-title">Significance</h2>
            <p className="section-copy">
              Supports lifeguards and facility administrators by reducing reaction time, improving situational awareness,
              and strengthening preventive safety practices.
            </p>
          </article>
        </section>

        <footer className="mt-auto pt-8 text-center text-xs text-sky-100/70">
          <p>
            © 2026 Cavite State University - Bacoor Campus | Salbavision: Smart Surveillance Drowning Detection and Alert System
          </p>
        </footer>
      </div>
    </main>
  );
}
