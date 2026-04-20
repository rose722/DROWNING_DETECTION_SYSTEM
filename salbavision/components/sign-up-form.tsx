"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { toast } from "sonner";

export function SignUpForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [firstname, setFirstname] = useState("");
  const [lastname, setLastname] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role] = useState("admin");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      // Check if email already exists
      const { data: existingUser, error: queryError } = await supabase
        .from("users")
        .select("email")
        .eq("email", email)
        .limit(1);
      
      if (queryError) throw queryError;
      if (existingUser && existingUser.length > 0) {
        setError("Email already exists. Please use a different email.");
        setIsLoading(false);
        return;
      }

      // Hash password before storing in users table
      const hashedPassword = bcrypt.hashSync(password, 10);

      // Insert user into custom users table (no Supabase Auth)
      const { error: insertError } = await supabase.from("users").insert([
        {
          id: uuidv4(),
          firstname,
          lastname,
          email,
          password: hashedPassword,
          role,
        },
      ]);
      if (insertError) throw insertError;

      toast.success("Sign up successful! You can now log in.");
      setTimeout(() => {
        window.location.replace("/auth/login");
      }, 1200);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }

  };

  return (
    <div className={cn("flex flex-col items-center justify-center min-h-screen", className)} {...props}>
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="flex flex-col items-center">
          <CardTitle className="text-2xl text-center">Create Your Account</CardTitle>
          <CardDescription className="text-center">Register to access the Drowning Detection System</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignUp} className="space-y-5">
            <div>
              <Label htmlFor="firstname">First Name</Label>
              <Input
                id="firstname"
                type="text"
                placeholder="Juan"
                required
                value={firstname}
                onChange={(e) => setFirstname(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="lastname">Last Name</Label>
              <Input
                id="lastname"
                type="text"
                placeholder="Dela Cruz"
                required
                value={lastname}
                onChange={(e) => setLastname(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="m@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1"
              />
            </div>
            {error && <div className="text-sm text-center text-red-500">{error}</div>}
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Creating an account..." : "Sign up"}
            </Button>
            <div className="text-center text-sm mt-2">
              Already have an account?{' '}
              <Link href="/auth/login" className="text-blue-700 hover:underline">Login</Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
