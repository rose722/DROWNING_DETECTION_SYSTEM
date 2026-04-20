import { NextResponse } from "next/server";

export async function GET() {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  // Helper to fetch count
  const fetchCount = async (query: string) => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, { headers });
    const data = await res.json();
    return data[0]?.count ?? 0;
  };

  // Active cameras
  const activeCameras = await fetchCount("cameras?is_active=eq.true&select=count(*)");
  // Ongoing alerts
  const ongoingAlerts = await fetchCount("alerts?status=eq.ongoing&select=count(*)");
  // Detections today
  const today = new Date().toISOString().slice(0, 10);
  const detectionsToday = await fetchCount(`alerts?alert_time=gte.${today}T00:00:00&alert_time=lt.${today}T23:59:59&select=count(*)`);
  // Total incidents
  const totalIncidents = await fetchCount("alerts?select=count(*)");

  // Graph data (last 7 days)
  const graphData: { labels: string[]; values: number[] } = { labels: [], values: [] };
  for (let i = 6; i >= 0; i--) {
    const day = new Date();
    day.setDate(day.getDate() - i);
    const dateStr = day.toISOString().slice(0, 10);
    graphData.labels.push(day.toLocaleDateString("en-US", { month: "short", day: "2-digit" }));
    const count = await fetchCount(`alerts?alert_time=gte.${dateStr}T00:00:00&alert_time=lt.${dateStr}T23:59:59&select=count(*)`);
    graphData.values.push(count);
  }

  // DEBUG: Log the graph data and counts to the server console
  console.log("[DASHBOARD API] graphData:", graphData);
  console.log("[DASHBOARD API] activeCameras:", activeCameras, "ongoingAlerts:", ongoingAlerts, "detectionsToday:", detectionsToday, "totalIncidents:", totalIncidents);

  return NextResponse.json({
    activeCameras,
    ongoingAlerts,
    detectionsToday,
    totalIncidents,
    graphData,
  });
}