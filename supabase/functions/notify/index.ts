// notify — create an in-app notification and (optionally) mirror it to Slack.
// Producers: note @mentions and task assignment (D6). Inserts the notification
// row (Realtime pushes it to the bell), then, if SLACK_BOT_TOKEN is set, resolves
// the target's Slack user by email and DMs them a deep link. Graceful no-op
// without the token or on lookup failure.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient, json, CORS_HEADERS } from "../_shared/supabase.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const { user_id, kind, title, body, link } = await req.json();
  if (!user_id || !kind || !title) return json({ error: "user_id, kind, title required" }, 400);

  const supabase = serviceClient();
  const { error } = await supabase.from("notifications").insert({ user_id, kind, title, body: body ?? null, link: link ?? null });
  if (error) return json({ error: error.message }, 500);

  let slack = false;
  const token = Deno.env.get("SLACK_BOT_TOKEN");
  if (token) {
    try {
      const { data: profile } = await supabase.from("profiles").select("email").eq("id", user_id).maybeSingle();
      if (profile?.email) {
        const lookup = await fetch("https://slack.com/api/users.lookupByEmail", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ email: profile.email }),
        }).then((r) => r.json());
        if (lookup.ok && lookup.user?.id) {
          const appUrl = Deno.env.get("APP_URL") ?? "";
          const text = `*${title}*\n${body ?? ""}${link ? `\n<${appUrl}${link}|Open in Compass>` : ""}`;
          const post = await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
            body: JSON.stringify({ channel: lookup.user.id, text }),
          }).then((r) => r.json());
          slack = !!post.ok;
        }
      }
    } catch (e) {
      console.error("slack notify failed:", (e as Error).message); // non-fatal
    }
  }

  return json({ ok: true, slack });
});
