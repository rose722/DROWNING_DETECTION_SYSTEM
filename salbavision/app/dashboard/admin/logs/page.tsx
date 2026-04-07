"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface AlertRow {
  id: number;
  camera_id: string;
  alert_message: string;
  status: string;
  confidence: number;
  alert_time: string;
}

export default function DetectionLogsPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState("Admin");
  const [logs, setLogs] = useState<AlertRow[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
    const userRole = localStorage.getItem("userRole");
    if (!isLoggedIn || (userRole && userRole !== "admin")) {
      window.location.replace("/auth/login");
      return;
    }
    setChecking(false);
  }, []);

  useEffect(() => {
    if (checking) return;
    let isMounted = true;
    const fetchLogs = async () => {
      try {
        setLoading(true);
        setError(null);
        const userEmail = localStorage.getItem("userEmail");
        if (userEmail) {
          const { data: userRow, error: userError } = await supabase
            .from("users")
            .select("firstname, lastname")
            .eq("email", userEmail)
            .limit(1)
            .maybeSingle();
          if (!userError && userRow) {
            const name = `${userRow.firstname ?? ""} ${userRow.lastname ?? ""}`.trim();
            if (name) setFullName(name);
          }
        }
        const { data, error: logsError } = await supabase
          .from("alerts")
          .select("id, camera_id, alert_message, status, confidence, alert_time")
          .order("alert_time", { ascending: false });
        if (logsError) throw logsError;
        if (isMounted) setLogs(data || []);
      } catch (err: any) {
        if (isMounted) setError(err?.message ?? "Failed to load logs.");
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    fetchLogs();
    return () => {
      isMounted = false;
    };
  }, [checking, supabase]);

  // Filtered logs
  const filteredLogs = logs.filter((row) => {
    const text = `${row.id} ${row.camera_id} ${row.alert_message} ${row.status} ${row.confidence} ${row.alert_time}`.toLowerCase();
    return text.includes(search.toLowerCase());
  });

  // CSV Export
  const exportCSV = () => {
    const header = ["ID", "Camera", "Alert Message", "Status", "Confidence", "Alert Time"];
    const rows = filteredLogs.map((row) => [
      row.id,
      row.camera_id,
      row.alert_message,
      row.status,
      `${(row.confidence * 100).toFixed(2)}%`,
      row.alert_time,
    ]);
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "detection_logs.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (checking) {
    return <div className="flex min-h-screen items-center justify-center">Checking session...</div>;
  }

  return (
    <div className="min-h-screen bg-[#eef3ff] text-slate-900">
      <div className="fixed left-0 top-0 flex h-screen w-[270px] flex-col bg-[#0a1f44] px-5 py-7 text-white shadow-[4px_0_20px_rgba(0,0,0,0.25)]">
        <div className="mb-10 text-center">
          <img src="/images/Salbavision.png" alt="SALBAVISION Logo" className="mx-auto mb-2 w-[110px]" />
          <h2 className="text-[22px] font-bold tracking-[2px]">SALBAVISION</h2>
        </div>
        <a href="/dashboard/admin" className="mb-3 rounded-[10px] px-4 py-3 text-[#c8d6ff] transition hover:bg-white/10 hover:text-white"><i className="fas fa-chart-line mr-2" /> Dashboard</a>
        <a href="/dashboard/admin/logs" className="mb-3 rounded-[10px] bg-gradient-to-br from-[#0b63ff] to-[#4da3ff] px-4 py-3 text-white"><i className="fas fa-list mr-2" /> Detection Logs</a>
        <a href="/dashboard/admin/detection" className="mb-3 rounded-[10px] px-4 py-3 text-[#c8d6ff] transition hover:bg-white/10 hover:text-white"><i className="fas fa-video mr-2" /> Real-Time Detection</a>
        <a href="/dashboard/admin/settings" className="mb-3 rounded-[10px] px-4 py-3 text-[#c8d6ff] transition hover:bg-white/10 hover:text-white"><i className="fas fa-cog mr-2" /> Settings</a>
        <button type="button" onClick={() => { localStorage.clear(); router.replace("/auth/login"); }} className="mt-auto rounded-[10px] border border-white/20 px-4 py-3 text-left text-[#c8d6ff] transition hover:bg-white/10 hover:text-white"><i className="fas fa-sign-out-alt mr-2" /> Logout</button>
      </div>
      <div className="ml-[270px] p-6">
        <div className="topbar mb-8 flex items-center justify-between rounded-[14px] bg-white px-7 py-5 shadow-[0_3px_10px_rgba(0,0,0,0.08)]">
          <h4 className="m-0 text-xl font-semibold text-[#1b2b52]">📜 Detection Logs</h4>
          <div className="user-info flex items-center gap-2 font-semibold text-[#2c3e75] text-base"><i className="fas fa-user" /> {fullName}</div>
        </div>
        <div className="logs-container">
          <div className="mb-4 flex items-center justify-between gap-4">
            <input type="text" className="form-control flex-1 rounded border px-3 py-2" placeholder="🔍 Search logs..." value={search} onChange={e => setSearch(e.target.value)} />
            <button className="btn btn-success ml-3 flex items-center gap-2 rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700" onClick={exportCSV}><i className="fas fa-file-csv" /> Export CSV</button>
          </div>
          {error && <div className="mb-4 rounded bg-red-100 px-4 py-2 text-red-700">{error}</div>}
          <div className="overflow-x-auto rounded-lg bg-white p-2 shadow">
            <table className="min-w-full border-collapse text-center">
              <thead>
                <tr>
                  <th className="bg-[#0b63ff] px-4 py-2 text-white">ID</th>
                  <th className="bg-[#0b63ff] px-4 py-2 text-white">Camera</th>
                  <th className="bg-[#0b63ff] px-4 py-2 text-white">Alert Message</th>
                  <th className="bg-[#0b63ff] px-4 py-2 text-white">Status</th>
                  <th className="bg-[#0b63ff] px-4 py-2 text-white">Confidence</th>
                  <th className="bg-[#0b63ff] px-4 py-2 text-white">Alert Time</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="py-8 text-center">Loading...</td></tr>
                ) : filteredLogs.length === 0 ? (
                  <tr><td colSpan={6} className="py-8 text-center">No logs found.</td></tr>
                ) : (
                  filteredLogs.map((row) => (
                    <tr key={row.id} className="border-b hover:bg-[#f3f7ff]">
                      <td className="px-4 py-2">{row.id}</td>
                      <td className="px-4 py-2">{row.camera_id}</td>
                      <td className="px-4 py-2">{row.alert_message}</td>
                      <td className="px-4 py-2">
                        {row.status.toLowerCase() === "ongoing" ? (
                          <span className="rounded bg-red-600 px-2 py-1 text-xs text-white">Ongoing</span>
                        ) : (
                          <span className="rounded bg-green-600 px-2 py-1 text-xs text-white">Resolved</span>
                        )}
                      </td>
                      <td className="px-4 py-2">{(row.confidence * 100).toFixed(2)}%</td>
                      <td className="px-4 py-2">{row.alert_time}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <footer className="mt-10 text-center text-sm text-slate-500">
          © 2025 Cavite State University - Bacoor Campus | Smart Drowning Detection & Alert System
        </footer>
      </div>
    </div>
  );
}
