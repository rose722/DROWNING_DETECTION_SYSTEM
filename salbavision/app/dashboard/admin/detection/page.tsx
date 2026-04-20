"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function RealTimeDetectionPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [checking, setChecking] = useState(true);
  const [fullName, setFullName] = useState("User");
  const [alertActive, setAlertActive] = useState(false);
  const alertSoundRef = useRef<HTMLAudioElement>(null);

  // Session/role check
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
    const userRole = localStorage.getItem("userRole");
    if (!isLoggedIn || (userRole !== "admin" && userRole !== "lifeguard")) {
      window.location.replace("/auth/login");
      return;
    }
    setChecking(false);
  }, []);

  // Fetch user name
  useEffect(() => {
    if (checking) return;
    const userEmail = localStorage.getItem("userEmail");
    if (!userEmail) return;
    let isMounted = true;
    supabase
      .from("users")
      .select("firstname, lastname")
      .eq("email", userEmail)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (isMounted && data) {
          const name = `${data.firstname ?? ""} ${data.lastname ?? ""}`.trim();
          if (name) setFullName(name);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [checking, supabase]);

  // Poll for alert
  useEffect(() => {
    if (checking) return;
    let interval: NodeJS.Timeout;
    let ignore = false;
    const poll = async () => {
      try {
        const res = await fetch("http://localhost:5001/latest_alert");
        const data = await res.json();
        if (data && !alertActive && !ignore) {
          setAlertActive(true);
          if (alertSoundRef.current && alertSoundRef.current.paused) {
            alertSoundRef.current.play();
          }
        }
      } catch (e) {
        // ignore
      }
    };
    interval = setInterval(poll, 2000);
    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, [checking, alertActive]);


  if (checking) {
    return <div className="flex min-h-screen items-center justify-center">Checking session...</div>;
  }

  return (
    <div className="min-h-screen bg-[#eef3ff] text-slate-900">
      <div className="fixed left-0 top-0 flex h-screen w-[270px] flex-col bg-[#0a1f44] px-5 py-7 text-white shadow-[4px_0_20px_rgba(0,0,0,0.25)]">
        <div className="mb-9 text-center">
          <img src="/images/Salbavision.png" alt="SALBAVISION Logo" className="mx-auto mb-2 w-[110px]" />
          <h2 className="text-[22px] font-bold tracking-[2px]">SALBAVISION</h2>
        </div>
        <a href="/dashboard/admin" className="mb-3 rounded-[10px] px-4 py-3 text-[#c8d6ff] transition hover:bg-white/10 hover:text-white"><i className="fas fa-chart-line mr-2" /> Dashboard</a>
        <a href="/dashboard/admin/logs" className="mb-3 rounded-[10px] px-4 py-3 text-[#c8d6ff] transition hover:bg-white/10 hover:text-white"><i className="fas fa-list mr-2" /> Detection Logs</a>
        <a href="/dashboard/admin/detection" className="mb-3 rounded-[10px] bg-gradient-to-br from-[#0b63ff] to-[#4da3ff] px-4 py-3 text-white"><i className="fas fa-video mr-2" /> Real-Time Detection</a>
        <a href="/dashboard/admin/settings" className="mb-3 rounded-[10px] px-4 py-3 text-[#c8d6ff] transition hover:bg-white/10 hover:text-white"><i className="fas fa-cog mr-2" /> Settings</a>
        <button type="button" onClick={() => { localStorage.clear(); router.replace("/auth/login"); }} className="mt-auto rounded-[10px] border border-white/20 px-4 py-3 text-left text-[#c8d6ff] transition hover:bg-white/10 hover:text-white"><i className="fas fa-sign-out-alt mr-2" /> Logout</button>
      </div>
      <div className="ml-[270px] p-6">
        <div className="topbar mb-6 flex items-center justify-between rounded-[14px] bg-white px-7 py-5 shadow-[0_3px_10px_rgba(0,0,0,0.08)]">
          <h4 className="m-0 text-xl font-semibold text-[#1b2b52]">📡 CCTV Monitoring (Real-Time)</h4>
          <div className="user-info flex items-center gap-2 font-semibold text-[#2c3e75] text-base"><i className="fas fa-user-circle" /> {fullName}</div>
        </div>
        <div className="camera-card w-full rounded-[16px] bg-white p-6 shadow-[0_5px_15px_rgba(0,0,0,0.08)]">
          <div className="camera-video">
            <h5 className="mb-3 text-lg font-semibold">Camera 1 – Main Pool</h5>
            <img src="http://localhost:5001/video_feed" alt="Camera Feed" className="h-[680px] w-full rounded-[14px] object-cover bg-black" />
          </div>
        </div>
        {/* Alert Banner */}
        <div style={{ display: alertActive ? "block" : "none" }} className="mt-6 rounded-[10px] bg-[#ff3b3b] px-6 py-4 text-center text-lg font-bold text-white">
          🚨 DROWNING DETECTED — RESPOND IMMEDIATELY!
        </div>
        <audio ref={alertSoundRef} src="/siren.mp3" />
        <footer className="mt-10 text-center text-sm text-slate-500">
          © 2025 Cavite State University - Bacoor Campus | Smart Drowning Detection System
        </footer>
      </div>
    </div>
  );
}
