"use client";

import { createClient } from "@/lib/supabase/client";
import Chart from "chart.js/auto";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

type DashboardStats = {
  activeCameras: number;
  ongoingAlerts: number;
  detectionsToday: number;
  totalIncidents: number;
};

type TrendData = {
  labels: string[];
  values: number[];
};

type LastAlert = {
  alert_time?: string;
  status?: string;
} | null;

const defaultStats: DashboardStats = {
  activeCameras: 0,
  ongoingAlerts: 0,
  detectionsToday: 0,
  totalIncidents: 0,
};

export default function AdminDashboard() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const chartCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState("Admin");
  const [stats, setStats] = useState<DashboardStats>(defaultStats);
  const [trend, setTrend] = useState<TrendData>({ labels: [], values: [] });
  const [lastAlert, setLastAlert] = useState<LastAlert>(null);
  const [totalCameras, setTotalCameras] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
    const userRole = localStorage.getItem("userRole");

    if (!isLoggedIn || (userRole && userRole !== "admin")) {
      window.location.replace("/auth/login");
      return;
    }

    setChecking(false);
  }, []);

  // --- Real-time dashboard update logic ---
  const loadDashboard = useCallback(async () => {
    let isMounted = true;
    try {
      setLoading(true);
      setError(null);

      const userEmail = typeof window !== "undefined" ? localStorage.getItem("userEmail") : null;
      if (userEmail) {
        const { data: userRow, error: userError } = await supabase
          .from("users")
          .select("firstname, lastname")
          .eq("email", userEmail)
          .limit(1)
          .maybeSingle();

        if (userError) {
          throw userError;
        }

        const name = `${userRow?.firstname ?? ""} ${userRow?.lastname ?? ""}`.trim();
        if (name) {
          setFullName(name);
        }
      }

      const fetchCount = async (
        table: string,
        applyFilter?: (query: any) => any,
      ) => {
        let query = supabase.from(table).select("*", { head: true, count: "exact" });
        if (applyFilter) {
          query = applyFilter(query);
        }
        const { count, error: countError } = await query;
        if (countError) {
          throw countError;
        }
        return count ?? 0;
      };

      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const tomorrowStart = new Date(todayStart);
      tomorrowStart.setDate(tomorrowStart.getDate() + 1);

      const activeCameras = await fetchCount("cameras", (q) => q.eq("is_active", true));
      const ongoingAlerts = await fetchCount("alerts", (q) => q.eq("status", "ongoing"));
      const detectionsToday = await fetchCount("alerts", (q) =>
        q.gte("alert_time", todayStart.toISOString()).lt("alert_time", tomorrowStart.toISOString()),
      );
      const totalIncidents = await fetchCount("alerts");
      const allCameras = await fetchCount("cameras");

      const labels: string[] = [];
      const values: number[] = [];

      for (let i = 6; i >= 0; i -= 1) {
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);
        dayStart.setDate(dayStart.getDate() - i);

        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);

        labels.push(
          dayStart.toLocaleDateString("en-US", {
            month: "short",
            day: "2-digit",
          }),
        );

        const dayCount = await fetchCount("alerts", (q) =>
          q.gte("alert_time", dayStart.toISOString()).lt("alert_time", dayEnd.toISOString()),
        );
        values.push(dayCount);
      }

      const { data: alertRow, error: alertError } = await supabase
        .from("alerts")
        .select("alert_time, status")
        .order("alert_time", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (alertError) {
        throw alertError;
      }

      if (!isMounted) {
        return;
      }

      setStats({
        activeCameras,
        ongoingAlerts,
        detectionsToday,
        totalIncidents,
      });
      setTotalCameras(allCameras);
      setTrend({ labels, values });
      setLastAlert(alertRow);
    } catch (loadError: any) {
      setError(loadError?.message ?? "Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
    return () => {
      isMounted = false;
    };
  }, [supabase]);

  useEffect(() => {
    if (checking) return;
    loadDashboard();
  }, [checking, loadDashboard]);

  // Real-time subscription for alerts and cameras
  useEffect(() => {
    if (checking) return;
    // Subscribe to alerts and cameras changes
    const alertsSub = supabase.channel('alerts-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => {
        loadDashboard();
      })
      .subscribe();
    const camerasSub = supabase.channel('cameras-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cameras' }, () => {
        loadDashboard();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(alertsSub);
      supabase.removeChannel(camerasSub);
    };
  }, [checking, supabase, loadDashboard]);

  useEffect(() => {
    if (!chartCanvasRef.current || trend.labels.length === 0) {
      return;
    }

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    chartRef.current = new Chart(chartCanvasRef.current, {
      type: "line",
      data: {
        labels: trend.labels,
        datasets: [
          {
            label: "Alerts",
            data: trend.values,
            borderWidth: 3,
            borderColor: "#0b63ff",
            tension: 0.35,
            fill: true,
            backgroundColor: "rgba(11,99,255,0.12)",
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
      },
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [trend]);

  const handleLogout = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("isLoggedIn");
      localStorage.removeItem("userEmail");
      localStorage.removeItem("userRole");
    }
    router.replace("/auth/login");
  };

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
        <a href="/dashboard/admin" className="mb-3 rounded-[10px] bg-gradient-to-br from-[#0b63ff] to-[#4da3ff] px-4 py-3 text-white"><i className="fas fa-chart-line mr-2" /> Dashboard</a>
        <a href="/dashboard/admin/logs" className="mb-3 rounded-[10px] px-4 py-3 text-[#c8d6ff] transition hover:bg-white/10 hover:text-white"><i className="fas fa-list mr-2" /> Detection Logs</a>
        <a href="/dashboard/admin/detection" className="mb-3 rounded-[10px] px-4 py-3 text-[#c8d6ff] transition hover:bg-white/10 hover:text-white"><i className="fas fa-video mr-2" /> Real-Time Detection</a>
        <a href="/dashboard/admin/settings" className="mb-3 rounded-[10px] px-4 py-3 text-[#c8d6ff] transition hover:bg-white/10 hover:text-white"><i className="fas fa-cog mr-2" /> Settings</a>
        <button type="button" onClick={handleLogout} className="mt-auto rounded-[10px] border border-white/20 px-4 py-3 text-left text-[#c8d6ff] transition hover:bg-white/10 hover:text-white"><i className="fas fa-sign-out-alt mr-2" /> Logout</button>
      </div>

      <div className="ml-[270px] p-6">
        <div className="mb-6 flex items-center justify-between rounded-[14px] bg-white px-6 py-5 shadow-[0_4px_14px_rgba(0,0,0,0.08)]">
          <div>
            <h4 className="m-0 text-2xl font-semibold">Drowning Detection Dashboard</h4>
            <small className="text-slate-500">System Overview and Status</small>
          </div>
          <div className="font-semibold">{fullName}</div>
        </div>

        {error && (
          <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-5">
          <StatCard label="Active Cameras" value={stats.activeCameras} loading={loading} />
          <StatCard label="Ongoing Alerts" value={stats.ongoingAlerts} loading={loading} />
          <StatCard label="Detections Today" value={stats.detectionsToday} loading={loading} />
          <StatCard label="Total Incidents" value={stats.totalIncidents} loading={loading} />
        </div>

        <div className="mt-9 flex justify-center">
          <div className="w-[85%] rounded-[18px] bg-white p-6 shadow-[0_6px_20px_rgba(0,0,0,0.06)]">
            <h6 className="mb-4 text-sm font-bold text-[#1d2d50]">Detection Trend (Last 7 Days)</h6>
            <canvas ref={chartCanvasRef} height={180} />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-5">
          <div className="rounded-[14px] bg-white p-6 shadow-[0_4px_16px_rgba(0,0,0,0.05)]">
            <h6 className="mb-3 text-sm font-bold text-[#1d2d50]">Last Alert</h6>
            <p className="mb-3 text-sm text-slate-600">
              {lastAlert?.alert_time
                ? `${new Date(lastAlert.alert_time).toLocaleString()} (${lastAlert.status ?? "unknown"})`
                : "No alerts recorded yet."}
            </p>
            <div className="flex gap-2">
              <a
                href="/dashboard/admin/logs"
                className="inline-block rounded bg-[#0b63ff] px-3 py-2 text-xs text-white"
              >
                View Logs
              </a>
              <button
                onClick={async () => {
                  setLoading(true);
                  try {
                    const { data: alertRow, error: alertError } = await supabase
                      .from("alerts")
                      .select("alert_time, status")
                      .order("alert_time", { ascending: false })
                      .limit(1)
                      .maybeSingle();
                    if (alertError) throw alertError;
                    setLastAlert(alertRow);
                  } catch (e) {
                    setError("Failed to refresh last alert.");
                  } finally {
                    setLoading(false);
                  }
                }}
                className="inline-block rounded border border-[#0b63ff] px-3 py-2 text-xs text-[#0b63ff] hover:bg-[#eaf1ff]"
                title="Refresh Last Alert"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="rounded-[14px] bg-white p-6 shadow-[0_4px_16px_rgba(0,0,0,0.05)]">
            <h6 className="mb-3 text-sm font-bold text-[#1d2d50]">Camera Health</h6>
            <p className="mb-3 text-sm text-slate-600">
              {stats.activeCameras} of {totalCameras} cameras are online and active.
            </p>
            <a
              href="/dashboard/admin/settings?tab=camera"
              className="inline-block rounded border border-[#0b63ff] px-3 py-2 text-xs text-[#0b63ff] hover:bg-[#eaf1ff]"
            >
              Manage Cameras
            </a>
          </div>
        </div>

        <footer className="mt-10 text-center text-sm text-slate-500">
          © 2025 Cavite State University - Bacoor Campus | Smart Drowning Detection System
        </footer>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  loading,
}: {
  label: string;
  value: number;
  loading: boolean;
}) {
  return (
    <div className="rounded-[14px] bg-white p-6 shadow-[0_4px_16px_rgba(0,0,0,0.05)]">
      <h6 className="font-bold text-[#1d2d50]">{label}</h6>
      <div className="mt-1 text-4xl font-black text-[#0b63ff]">{loading ? "..." : value}</div>
    </div>
  );
}
