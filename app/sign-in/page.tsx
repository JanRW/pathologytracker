// app/sign-in/page.tsx
/*"use client";
import { useState } from "react";
//import { supabase } from "@/lib/supabaseClient";
import { supabase } from "../../lib/supabaseClient";


export default function SignInPage() {
  const [email, setEmail] = useState(""); const [sent, setSent] = useState(false);
  const sendLink = async () => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined }
    });
    if (error) alert(error.message); else setSent(true);
  };
  return sent ? <div className="p-6">Check your email for the login link.</div> : (
    <div className="p-6 max-w-sm mx-auto space-y-3">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <input className="border p-2 w-full" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" />
      <button className="border p-2 w-full" onClick={sendLink}>Send magic link</button>
    </div>
  );
} */
"use client";
import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  async function sendLink() {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true, // create user if not exists
        emailRedirectTo: "http://localhost:3000/auth/callback?next=/",
      },
    });
    if (error) return alert(error.message);
    setSent(true);
  }

  if (sent) return <div className="p-6">Check your email for the login link.</div>;

  return (
    <div className="p-6 max-w-sm mx-auto space-y-3">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <input
        className="border p-2 w-full"
        placeholder="you@example.com"
        value={email}
        onChange={e => setEmail(e.target.value)}
        type="email"
      />
      <button className="border p-2 w-full" onClick={sendLink}>
        Send magic link
      </button>
    </div>
  );
}