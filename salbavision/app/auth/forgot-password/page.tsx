import { ForgotPasswordForm } from "@/components/forgot-password-form";

export default function Page() {
  return (
    <div className="login-bg">
      <div className="bubbles" />
      <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10 relative z-10">
        <div className="w-full max-w-sm">
          <ForgotPasswordForm />
        </div>
      </div>
    </div>
  );
}
