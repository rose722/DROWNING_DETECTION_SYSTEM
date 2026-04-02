"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AdminDashboard() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);


  useEffect(() => {
    if (typeof window !== "undefined") {
      if (localStorage.getItem("isLoggedIn") !== "true") {
        window.location.replace("/auth/login");
        return;
      }
      // Push many dummy states so back always stays here (browser back trap)
      for (let i = 0; i < 30; i++) {
        window.history.pushState(null, "", window.location.pathname);
      }
      // Always force dashboard on popstate
      setChecking(false);
      // Listen for back/forward navigation and force stay on dashboard
      const handlePopState = () => {
        window.location.replace("/dashboard/admin");
      };
      window.addEventListener("popstate", handlePopState);
      return () => {
        window.removeEventListener("popstate", handlePopState);
      };
    }
  }, [router]);

  const handleLogout = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("isLoggedIn");
    }
    router.replace("/auth/login");
  };

  if (checking) {
    return <div className="flex flex-col items-center justify-center min-h-screen p-8">Checking...</div>;
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8">
      <h1 className="text-3xl font-bold mb-4">Admin Dashboard</h1>
      <p className="text-lg">Welcome, admin! This is your dashboard.</p>
      <button
        className="mt-6 px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
        onClick={handleLogout}
      >
        Logout
      </button>
    </div>
  );
}
