"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SettingsPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [checking, setChecking] = useState(true);
  const [fullName, setFullName] = useState("Admin");
  const [tab, setTab] = useState<"camera" | "system" | "pool">("camera");
  const [cameras, setCameras] = useState<any[]>([]);
  const [settings, setSettings] = useState<any | null>(null);
  const [pools, setPools] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string>("");
  // Pool edit modal state
  const [editPool, setEditPool] = useState<any | null>(null);
  // Pool registration form state for preset logic
  const [poolForm, setPoolForm] = useState({
    pool_name: "",
    pool_type: "",
    depth: "",
    location: "",
    guidelines: "",
    restrictions: "",
    notes: ""
  });

  // Pool type presets
  const poolPresets: Record<string, { guidelines: string; restrictions: string; notes: string }> = {
    "Kiddie Pool": {
      guidelines: "For children only.\nMust be accompanied by a parent or guardian.\nWalk slowly near the pool.\nUse proper swimwear.",
      restrictions: "No diving.\nNo running.\nNo rough play.\nChildren must not be left unattended.",
      notes: "Even shallow water can be dangerous. Constant adult supervision is required."
    },
    "Adult Pool": {
      guidelines: "For adults and trained swimmers.\nFollow depth markings.\nObserve safety signs.\nSwim only when physically fit.",
      restrictions: "No intoxicated swimmers.\nNo children without guardian supervision.\nNo rough play.\nNo diving in non-designated areas.",
      notes: "Deep sections require caution for non-expert swimmers."
    },
    "Training Pool": {
      guidelines: "For swimming lessons and practice.\nInstructor or coach supervision is recommended.\nFollow lane discipline.\nWarm up before training.",
      restrictions: "No random play during training.\nNo unsupervised beginner use in deep areas.\nNo lane obstruction.",
      notes: "Best for structured lessons and skill development."
    },
    "Wave Pool": {
      guidelines: "Follow lifeguard instructions.\nStay in appropriate depth zones.\nUse flotation aid if needed.\nWatch children closely.",
      restrictions: "No reckless behavior.\nNo pushing.\nNo unsupervised children.\nAvoid use during medical discomfort.",
      notes: "Wave movement can increase panic and accidental submersion risk."
    },
    "Infinity Pool": {
      guidelines: "Swim carefully near the edge.\nFollow all posted safety warnings.\nUse designated areas only.",
      restrictions: "No climbing on overflow edge.\nNo rough play near the edge.\nNo running.\nNo unsafe selfies at the edge.",
      notes: "Infinity edges can be visually misleading and slippery."
    },
    "Therapy Pool": {
      guidelines: "For therapy and rehabilitation use.\nMust be supervised by therapist, nurse, or guardian.\nFollow prescribed session limits.",
      restrictions: "No unsupervised use.\nNo rough activity.\nNo recreational misuse during therapy sessions.",
      notes: "This pool is intended for guided rehabilitation and patient safety."
    },
    "Recreational Pool": {
      guidelines: "For leisure and family swimming.\nObserve all pool signs.\nWatch children closely.\nMaintain cleanliness.",
      restrictions: "No diving in shallow areas.\nNo running.\nNo glass objects.\nNo intoxicated swimming.",
      notes: "Mixed-age users require strong supervision and clear safety signage."
    },
    "Diving Pool": {
      guidelines: "For trained divers or authorized users.\nUse only designated diving platforms.\nCheck landing area before diving.",
      restrictions: "No untrained diving.\nNo horseplay on platforms.\nNo swimming in diving zone during active dives.",
      notes: "This is a high-risk pool zone requiring strict supervision."
    }
  };
  // Camera edit modal state
  const [editCamera, setEditCamera] = useState<any | null>(null);

  // Session/role check
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
    const userRole = localStorage.getItem("userRole");
    if (!isLoggedIn || userRole !== "admin") {
      window.location.replace("/auth/login");
      return;
    }
    setChecking(false);
  }, []);

  // Fetch user info, cameras, settings, pools
  useEffect(() => {
    if (checking) return;
    let isMounted = true;
    const fetchAll = async () => {
      try {
        setLoading(true);
        setError(null);
        // User info
        const userEmail = localStorage.getItem("userEmail");
        if (userEmail) {
          const { data: userRow } = await supabase
            .from("users")
            .select("firstname, lastname")
            .eq("email", userEmail)
            .limit(1)
            .maybeSingle();
          if (userRow) {
            const name = `${userRow.firstname ?? ""} ${userRow.lastname ?? ""}`.trim();
            if (name) setFullName(name);
          }
        }
        // Cameras
        const { data: camRows } = await supabase
          .from("cameras")
          .select("id, camera_name, rtsp_url, is_active")
          .order("created_at", { ascending: false });
        if (isMounted && camRows) setCameras(camRows);
        // Settings
        const { data: settingsRow } = await supabase
          .from("system_settings")
          .select("*")
          .eq("id", 1)
          .maybeSingle();
        if (isMounted) setSettings(settingsRow || {
          alert_sensitivity: "Medium",
          notify_sound: true,
          pool_depth: "1.8",
          camera_height: "3.0"
        });
        // Pools
        const { data: poolRows } = await supabase
          .from("pools")
          .select("*")
          .order("id", { ascending: false });
        if (isMounted && poolRows) setPools(poolRows);
      } catch (err: any) {
        if (isMounted) setError(err?.message ?? "Failed to load settings.");
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    fetchAll();
    return () => { isMounted = false; };
  }, [checking, supabase]);

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
        <a href="/dashboard/admin/detection" className="mb-3 rounded-[10px] px-4 py-3 text-[#c8d6ff] transition hover:bg-white/10 hover:text-white"><i className="fas fa-video mr-2" /> Real-Time Detection</a>
        <a href="/dashboard/admin/settings" className="mb-3 rounded-[10px] bg-gradient-to-br from-[#0b63ff] to-[#4da3ff] px-4 py-3 text-white"><i className="fas fa-cog mr-2" /> Settings</a>
        <button type="button" onClick={() => { localStorage.clear(); router.replace("/auth/login"); }} className="mt-auto rounded-[10px] border border-white/20 px-4 py-3 text-left text-[#c8d6ff] transition hover:bg-white/10 hover:text-white"><i className="fas fa-sign-out-alt mr-2" /> Logout</button>
      </div>
      <div className="ml-[270px] p-6">
        <div className="topbar mb-6 flex items-center justify-between rounded-[14px] bg-white px-7 py-5 shadow-[0_4px_14px_rgba(0,0,0,0.08)]">
          <div>
            <h4 className="m-0 text-2xl font-semibold">⚙️ System Settings</h4>
            <small className="text-slate-500">Camera, Detection & Pool Registration</small>
          </div>
          <div className="font-semibold"><i className="fas fa-user-circle" /> {fullName}</div>
        </div>
        {/* Alerts/messages */}
        {msg && <div className="mb-4 rounded bg-green-100 px-4 py-2 text-green-700">{msg}</div>}
        {error && <div className="mb-4 rounded bg-red-100 px-4 py-2 text-red-700">{error}</div>}
        {/* Tabs */}
        <div className="mb-4 flex gap-2 border-b">
          <button
            className={`px-6 py-2 rounded-t-lg font-bold text-base transition-all duration-150 shadow-sm border-b-4 ${tab === "camera"
              ? "bg-gradient-to-r from-blue-600 to-blue-400 text-white border-blue-500"
              : "bg-white text-blue-700 border-transparent hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300"}`}
            style={{ outline: "none" }}
            onClick={() => setTab("camera")}
          >
            <span className="mr-2">🎥</span>Cameras
          </button>
          <button
            className={`px-6 py-2 rounded-t-lg font-bold text-base transition-all duration-150 shadow-sm border-b-4 ${tab === "system"
              ? "bg-gradient-to-r from-blue-600 to-blue-400 text-white border-blue-500"
              : "bg-white text-blue-700 border-transparent hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300"}`}
            style={{ outline: "none" }}
            onClick={() => setTab("system")}
          >
            <span className="mr-2">⚡</span>Detection
          </button>
          <button
            className={`px-6 py-2 rounded-t-lg font-bold text-base transition-all duration-150 shadow-sm border-b-4 ${tab === "pool"
              ? "bg-gradient-to-r from-blue-600 to-blue-400 text-white border-blue-500"
              : "bg-white text-blue-700 border-transparent hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300"}`}
            style={{ outline: "none" }}
            onClick={() => setTab("pool")}
          >
            <span className="mr-2">🏊</span>Pools
          </button>
        </div>
        {/* Tab content skeletons */}
        <div className="tab-content">
          {tab === "camera" && (
            <div className="bg-white rounded-xl shadow p-0 mb-8 border border-slate-100">
              <table className="min-w-full text-base">
                <thead>
                  <tr className="bg-white">
                    <th className="px-6 py-3 text-left font-bold text-slate-900">ID</th>
                    <th className="px-6 py-3 text-left font-bold text-slate-900">Name</th>
                    <th className="px-6 py-3 text-left font-bold text-slate-900">RTSP URL</th>
                    <th className="px-6 py-3 text-left font-bold text-slate-900">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {cameras.length === 0 ? (
                    <tr><td colSpan={4} className="text-center text-slate-400 py-4">No cameras found.</td></tr>
                  ) : (
                    cameras.map((cam: any) => (
                      <tr key={cam.id} className="border-t last:rounded-b-xl hover:bg-blue-50/40">
                        <td className="px-6 py-3">{cam.id}</td>
                        <td className="px-6 py-3">{cam.camera_name}</td>
                        <td className="px-6 py-3" style={{ maxWidth: 350, wordBreak: "break-all" }}>{cam.rtsp_url}</td>
                        <td className="px-6 py-3">
                          {cam.is_active ? (
                            <span className="inline-block rounded bg-green-600 px-3 py-1 text-white text-xs font-semibold">Yes</span>
                          ) : (
                            <span className="inline-block rounded bg-slate-300 px-3 py-1 text-slate-700 text-xs font-semibold">No</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
          // ...existing code...
            // Pool type presets (already present above, reused here)
          {tab === "system" && (
            <div className="bg-white rounded-xl shadow p-8 mb-8 border border-slate-100">
              <form
                className="flex flex-col gap-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setLoading(true);
                  setError(null);
                  setMsg("");
                  const form = e.target as HTMLFormElement;
                  const formData = new FormData(form);
                  const alert_sensitivity = formData.get("alert_sensitivity") as string;
                  const notify_sound = formData.get("notify_sound") === "on";
                  const pool_depth = formData.get("pool_depth") as string;
                  const camera_height = formData.get("camera_height") as string;
                  const { error: updateErr } = await supabase
                    .from("system_settings")
                    .update({ alert_sensitivity, notify_sound, pool_depth, camera_height })
                    .eq("id", 1);
                  if (updateErr) {
                    setError("✖ Something went wrong.");
                  } else {
                    setMsg("✔ Settings saved successfully!");
                    setSettings({ ...settings, alert_sensitivity, notify_sound, pool_depth, camera_height });
                  }
                  setLoading(false);
                }}
              >
                <div>
                  <label className="font-bold mb-2 block">Alert Sensitivity</label>
                  <select
                    className="w-full rounded border px-3 py-2 mb-2 focus:ring-2 focus:ring-blue-400 text-base"
                    name="alert_sensitivity"
                    value={settings?.alert_sensitivity || "Medium"}
                    onChange={e => setSettings({ ...settings, alert_sensitivity: e.target.value })}
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    className="form-check-input accent-blue-600"
                    type="checkbox"
                    name="notify_sound"
                    checked={!!settings?.notify_sound}
                    onChange={e => setSettings({ ...settings, notify_sound: e.target.checked })}
                  />
                  <label className="form-check-label">Enable Sound Alarm</label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 font-normal">Pool Depth (m)</label>
                    <input
                      type="number"
                      step="0.1"
                      className="form-control w-full rounded border px-3 py-2"
                      name="pool_depth"
                      value={settings?.pool_depth || ""}
                      onChange={e => setSettings({ ...settings, pool_depth: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="mb-1 font-normal">Camera Height (m)</label>
                    <input
                      type="number"
                      step="0.1"
                      className="form-control w-full rounded border px-3 py-2"
                      name="camera_height"
                      value={settings?.camera_height || ""}
                      onChange={e => setSettings({ ...settings, camera_height: e.target.value })}
                    />
                  </div>
                </div>
                <div className="mt-2">
                  <button className="px-6 py-2 rounded font-semibold bg-blue-600 hover:bg-blue-700 text-white text-base shadow" disabled={loading}>Save Settings</button>
                </div>
              </form>
            </div>
          )}
          {tab === "pool" && (
            <div className="bg-white rounded-xl shadow p-8 mb-8">
              <div className="flex items-center mb-6">
                <span className="text-2xl mr-2">🏊</span>
                <h2 className="text-xl font-bold">Pool Registration</h2>
              </div>
              <form
                className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setLoading(true);
                  setError(null);
                  setMsg("");
                  const { pool_name, pool_type, depth, location, guidelines, restrictions, notes } = poolForm;
                  const { error: insertErr } = await supabase.from("pools").insert([
                    { pool_name, pool_type, depth, location, guidelines, restrictions, notes },
                  ]);
                  if (insertErr) {
                    setError("✖ Something went wrong.");
                  } else {
                    setMsg("✔ Pool added successfully!");
                    // Reload pools
                    const { data: poolRows } = await supabase
                      .from("pools")
                      .select("*")
                      .order("id", { ascending: false });
                    setPools(poolRows || []);
                    setPoolForm({ pool_name: "", pool_type: "", depth: "", location: "", guidelines: "", restrictions: "", notes: "" });
                  }
                  setLoading(false);
                }}
              >
                {/* Row 1 */}
                <div className="flex flex-col">
                  <label className="form-label font-semibold text-blue-700">Pool Name</label>
                  <input type="text" className="form-control border-2 border-blue-300 focus:border-blue-500 rounded-lg bg-blue-50" name="pool_name" required value={poolForm.pool_name} onChange={e => setPoolForm(f => ({ ...f, pool_name: e.target.value }))} />
                </div>
                <div className="flex flex-col">
                  <label className="form-label font-semibold text-blue-700">Pool Type</label>
                  <select className="form-select border-2 border-blue-300 focus:border-blue-500 rounded-lg bg-blue-50" name="pool_type" id="pool_type" required value={poolForm.pool_type} onChange={e => {
                    const val = e.target.value;
                    setPoolForm(f => {
                      const preset = poolPresets[val];
                      return preset ? { ...f, pool_type: val, guidelines: preset.guidelines, restrictions: preset.restrictions, notes: preset.notes } : { ...f, pool_type: val };
                    });
                  }}>
                    <option value="">Select type</option>
                    <option value="Kiddie Pool">Kiddie Pool</option>
                    <option value="Adult Pool">Adult Pool</option>
                    <option value="Training Pool">Training Pool</option>
                    <option value="Wave Pool">Wave Pool</option>
                    <option value="Infinity Pool">Infinity Pool</option>
                    <option value="Therapy Pool">Therapy Pool</option>
                    <option value="Recreational Pool">Recreational Pool</option>
                    <option value="Diving Pool">Diving Pool</option>
                  </select>
                </div>
                <div className="flex flex-col">
                  <label className="form-label font-semibold text-blue-700">Depth (m)</label>
                  <input type="number" step="0.1" className="form-control border-2 border-blue-300 focus:border-blue-500 rounded-lg bg-blue-50" name="depth" value={poolForm.depth} onChange={e => setPoolForm(f => ({ ...f, depth: e.target.value }))} />
                </div>
                <div className="flex flex-col">
                  <label className="form-label font-semibold text-blue-700">Location</label>
                  <input type="text" className="form-control border-2 border-blue-300 focus:border-blue-500 rounded-lg bg-blue-50" name="location" value={poolForm.location} onChange={e => setPoolForm(f => ({ ...f, location: e.target.value }))} />
                </div>
                {/* Row 2 */}
                <div className="flex flex-col col-span-1">
                  <label className="form-label font-semibold">Guidelines</label>
                  <textarea className="form-control" name="guidelines" id="guidelines" rows={4} value={poolForm.guidelines} onChange={e => setPoolForm(f => ({ ...f, guidelines: e.target.value }))}></textarea>
                </div>
                <div className="flex flex-col col-span-1">
                  <label className="form-label font-semibold">Restrictions</label>
                  <textarea className="form-control" name="restrictions" id="restrictions" rows={4} value={poolForm.restrictions} onChange={e => setPoolForm(f => ({ ...f, restrictions: e.target.value }))}></textarea>
                </div>
                <div className="flex flex-col col-span-1">
                  <label className="form-label font-semibold">Notes</label>
                  <textarea className="form-control" name="notes" id="notes" rows={4} value={poolForm.notes} onChange={e => setPoolForm(f => ({ ...f, notes: e.target.value }))}></textarea>
                </div>
                <div className="flex items-end col-span-1">
                  <button
                    type="submit"
                    className="w-full flex items-center justify-center gap-2 px-5 py-2 rounded-lg font-bold text-base bg-gradient-to-r from-blue-600 to-blue-400 hover:from-blue-700 hover:to-blue-500 text-white shadow border-2 border-blue-400 transition-all duration-150"
                    disabled={loading}
                  >
                    <span className="text-xl">+</span> Add Pool
                  </button>
                </div>
              </form>

              {/* Edit Pool Modal */}
              {editPool && (
                <div className="modal fixed inset-0 z-50 flex items-center justify-center bg-black/40" style={{ display: "flex" }}>
                  <div className="modal-dialog modal-lg bg-white rounded-xl shadow-lg w-full max-w-md border-2 border-blue-400">
                    <form
                      className="modal-content p-0 flex flex-col h-[90vh] max-h-[600px]"
                      style={{ overflow: "hidden" }}
                      onSubmit={async (e) => {
                        e.preventDefault();
                        setLoading(true);
                        setError(null);
                        setMsg("");
                        const { id, ...fields } = editPool;
                        const { error: updateErr } = await supabase
                          .from("pools")
                          .update(fields)
                          .eq("id", id);
                        if (updateErr) {
                          setError("✖ Something went wrong.");
                        } else {
                          setMsg("✔ Pool updated successfully!");
                          setEditPool(null);
                          // Reload pools
                          const { data: poolRows } = await supabase
                            .from("pools")
                            .select("*")
                            .order("id", { ascending: false });
                          setPools(poolRows || []);
                        }
                        setLoading(false);
                      }}
                    >
                      <div className="modal-header flex items-center justify-between px-8 pt-8 pb-2">
                        <h5 className="modal-title text-xl font-bold text-blue-700">Edit Pool</h5>
                        <button type="button" className="btn-close" onClick={() => setEditPool(null)}></button>
                      </div>
                      <div className="flex-1 overflow-y-auto px-8 pb-2">
                        <input type="hidden" name="id" value={editPool.id} />
                        <div className="flex flex-col gap-2 mb-3">
                          <label className="form-label font-semibold text-blue-700">Pool Name</label>
                          <input type="text" className="form-control border-2 border-blue-300 focus:border-blue-500 rounded-lg bg-blue-50" name="pool_name" value={editPool.pool_name} onChange={e => setEditPool({ ...editPool, pool_name: e.target.value })} required />
                        </div>
                        <div className="flex flex-col gap-2 mb-3">
                          <label className="form-label font-semibold text-blue-700">Pool Type</label>
                          <select
                            className="form-select border-2 border-blue-300 focus:border-blue-500 rounded-lg bg-blue-50"
                            name="pool_type"
                            value={editPool.pool_type}
                            onChange={e => {
                              const val = e.target.value;
                              const preset = poolPresets[val];
                              setEditPool((prev: any) =>
                                preset
                                  ? { ...prev, pool_type: val, guidelines: preset.guidelines, restrictions: preset.restrictions, notes: preset.notes }
                                  : { ...prev, pool_type: val }
                              );
                            }}
                            required
                          >
                            <option value="Kiddie Pool">Kiddie Pool</option>
                            <option value="Adult Pool">Adult Pool</option>
                            <option value="Training Pool">Training Pool</option>
                            <option value="Wave Pool">Wave Pool</option>
                            <option value="Infinity Pool">Infinity Pool</option>
                            <option value="Therapy Pool">Therapy Pool</option>
                            <option value="Recreational Pool">Recreational Pool</option>
                            <option value="Diving Pool">Diving Pool</option>
                          </select>
                        </div>
                        <div className="flex flex-col gap-2 mb-3">
                          <label className="form-label font-semibold text-blue-700">Depth (m)</label>
                          <input type="number" step="0.1" className="form-control border-2 border-blue-300 focus:border-blue-500 rounded-lg bg-blue-50" name="depth" value={editPool.depth} onChange={e => setEditPool({ ...editPool, depth: e.target.value })} />
                        </div>
                        <div className="flex flex-col gap-2 mb-3">
                          <label className="form-label font-semibold text-blue-700">Location</label>
                          <input type="text" className="form-control border-2 border-blue-300 focus:border-blue-500 rounded-lg bg-blue-50" name="location" value={editPool.location} onChange={e => setEditPool({ ...editPool, location: e.target.value })} />
                        </div>
                        <div className="flex flex-col gap-2 mb-3">
                          <label className="form-label font-semibold text-blue-700">Guidelines</label>
                          <textarea className="form-control border-2 border-blue-300 focus:border-blue-500 rounded-lg bg-blue-50" name="guidelines" rows={4} value={editPool.guidelines} onChange={e => setEditPool({ ...editPool, guidelines: e.target.value })}></textarea>
                        </div>
                        <div className="flex flex-col gap-2 mb-3">
                          <label className="form-label font-semibold text-blue-700">Restrictions</label>
                          <textarea className="form-control border-2 border-blue-300 focus:border-blue-500 rounded-lg bg-blue-50" name="restrictions" rows={4} value={editPool.restrictions} onChange={e => setEditPool({ ...editPool, restrictions: e.target.value })}></textarea>
                        </div>
                        <div className="flex flex-col gap-2 mb-3">
                          <label className="form-label font-semibold text-blue-700">Notes</label>
                          <textarea className="form-control border-2 border-blue-300 focus:border-blue-500 rounded-lg bg-blue-50" name="notes" rows={4} value={editPool.notes} onChange={e => setEditPool({ ...editPool, notes: e.target.value })}></textarea>
                        </div>
                      </div>
                      <div className="modal-footer flex justify-end px-8 pb-6 pt-2 bg-white border-t">
                        <button type="submit" className="px-8 py-2 rounded font-bold bg-blue-600 hover:bg-blue-700 text-white text-base shadow-lg border-2 border-blue-400" disabled={loading}>Update Pool</button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {/* Pool Table */}
              <div className="overflow-x-auto rounded-xl shadow border border-slate-200">
                <table className="min-w-full text-base bg-white">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="px-4 py-3 text-left font-bold text-slate-900 border-b">ID</th>
                      <th className="px-4 py-3 text-left font-bold text-slate-900 border-b">Pool Name</th>
                      <th className="px-4 py-3 text-left font-bold text-slate-900 border-b">Type</th>
                      <th className="px-4 py-3 text-left font-bold text-slate-900 border-b">Depth</th>
                      <th className="px-4 py-3 text-left font-bold text-slate-900 border-b">Location</th>
                      <th className="px-4 py-3 text-left font-bold text-slate-900 border-b">Guidelines</th>
                      <th className="px-4 py-3 text-left font-bold text-slate-900 border-b">Restrictions</th>
                      <th className="px-4 py-3 text-left font-bold text-slate-900 border-b">Notes</th>
                      <th className="px-4 py-3 text-center font-bold text-slate-900 border-b" style={{ minWidth: 140 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pools.length === 0 ? (
                      <tr><td colSpan={9} className="text-center text-slate-400 py-6">No pools found.</td></tr>
                    ) : (
                      pools.map((p: any, idx: number) => (
                        <tr key={p.id} className={"border-t last:rounded-b-xl hover:bg-blue-50/40 " + (idx % 2 === 1 ? "bg-slate-50/50" : "bg-white") }>
                          <td className="px-4 py-3 align-top">{p.id}</td>
                          <td className="px-4 py-3 align-top font-semibold">{p.pool_name}</td>
                          <td className="px-4 py-3 align-top">{p.pool_type}</td>
                          <td className="px-4 py-3 align-top">{p.depth}m</td>
                          <td className="px-4 py-3 align-top">{p.location}</td>
                          <td className="px-4 py-3 align-top whitespace-pre-line max-w-[220px]">{p.guidelines}</td>
                          <td className="px-4 py-3 align-top whitespace-pre-line max-w-[220px]">{p.restrictions}</td>
                          <td className="px-4 py-3 align-top whitespace-pre-line max-w-[220px]">{p.notes}</td>
                          <td className="px-4 py-3 align-top text-center">
                            <div className="flex flex-col gap-2 items-center">
                              <button
                                className="px-4 py-1 rounded bg-yellow-400 hover:bg-yellow-500 text-white font-semibold text-sm shadow"
                                onClick={() => setEditPool({ ...p })}
                                disabled={loading}
                              >Edit</button>
                              <button
                                className="px-4 py-1 rounded bg-red-600 hover:bg-red-700 text-white font-semibold text-sm shadow"
                                onClick={async () => {
                                  if (!window.confirm("Are you sure you want to delete this pool?")) return;
                                  setLoading(true);
                                  setError(null);
                                  setMsg("");
                                  const { error: delErr } = await supabase.from("pools").delete().eq("id", p.id);
                                  if (delErr) {
                                    setError("✖ Something went wrong.");
                                  } else {
                                    setMsg("✔ Pool deleted successfully!");
                                    setPools(pools.filter(x => x.id !== p.id));
                                  }
                                  setLoading(false);
                                }}
                                disabled={loading}
                              >Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        // ...existing code...
        </div>
        <footer className="mt-10 text-center text-sm text-slate-500">
          © 2025 Cavite State University - Bacoor Campus
        </footer>
      </div>
    </div>
  );
}
