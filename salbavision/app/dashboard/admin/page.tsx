"use client";

import Chart from "chart.js/auto";
import { useEffect, useRef, useState } from "react";
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

const defaultStats: DashboardStats = {
  activeCameras: 0,
  ongoingAlerts: 0,
  detectionsToday: 0,
  totalIncidents: 0,
};

export default function AdminDashboard() {
  const router = useRouter();
  const chartCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardStats>(defaultStats);
  const [trend, setTrend] = useState<TrendData>({ labels: [], values: [] });
  const [lastAlert, setLastAlert] = useState<{ alert_time: string; status: string } | null>(null);
  const [totalCameras, setTotalCameras] = useState<number>(0);

  // Fetch dashboard stats, trend, last alert, and total cameras from API route
  const loadDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard-stats");
      const data = await res.json();
      setStats({
        activeCameras: data.activeCameras,
        ongoingAlerts: data.ongoingAlerts,
        detectionsToday: data.detectionsToday,
        totalIncidents: data.totalIncidents,
      });
      setTrend(data.graphData);
      setLastAlert(data.lastAlert ?? null);
      setTotalCameras(data.totalCameras ?? 0);
    } catch (e) {
      setError("Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);



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



  return (
    <div className="min-h-screen bg-[#eef3ff] text-slate-900">
      {/* Sidebar */}
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

      {/* Main Content */}
      <div className="ml-[270px] p-6">
        <div className="mb-6 flex items-center justify-between rounded-[14px] bg-white px-6 py-5 shadow-[0_4px_14px_rgba(0,0,0,0.08)]">
          <div>
            <h4 className="m-0 text-2xl font-semibold">Drowning Detection Dashboard</h4>
            <small className="text-slate-500">System Overview and Status</small>
          </div>
        </div>

        {/* Global Refresh Button */}
        <div className="mb-5 flex items-center gap-3">
          <button
            onClick={loadDashboard}
            className="rounded bg-[#0b63ff] px-4 py-2 text-white hover:bg-[#084bb5] disabled:opacity-60"
            disabled={loading}
            title="Refresh all dashboard data"
          >
            {loading ? "Refreshing..." : "Refresh Dashboard"}
          </button>
          {loading && <span className="text-[#0b63ff] text-sm">Loading data...</span>}
        </div>

        {error && (
          <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-5">
          <StatCard label="Active Cameras" value={stats.activeCameras} loading={loading} />
          <StatCard label="Ongoing Alerts" value={stats.ongoingAlerts} loading={loading} />
          <StatCard label="Detections Today" value={stats.detectionsToday} loading={loading} />
          <StatCard label="Total Incidents" value={stats.totalIncidents} loading={loading} />
        </div>

        {/* Detection Trend Graph */}
        <div className="mt-9 flex justify-center">
          <DashboardTrendGraph chartCanvasRef={chartCanvasRef} trend={trend} loading={loading} />
        </div>

        {/* Info Cards */}
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
                onClick={loadDashboard}
                className="inline-block rounded border border-[#0b63ff] px-3 py-2 text-xs text-[#0b63ff] hover:bg-[#eaf1ff]"
                title="Refresh Last Alert"
                disabled={loading}
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
// Modularized graph component for future extensibility
function DashboardTrendGraph({ chartCanvasRef, trend, loading }: { chartCanvasRef: React.RefObject<HTMLCanvasElement | null>, trend: TrendData, loading: boolean }) {
  return (
    <div className="w-[85%] rounded-[18px] bg-white p-6 shadow-[0_6px_20px_rgba(0,0,0,0.06)] min-h-[240px] flex flex-col items-center justify-center">
      <h6 className="mb-4 text-sm font-bold text-[#1d2d50]">Detection Trend (Last 7 Days)</h6>
      {loading ? (
        <div className="text-[#0b63ff] text-center py-8">Loading chart...</div>
      ) : (
        <canvas ref={chartCanvasRef} height={180} />
      )}
    </div>
  );
}
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
