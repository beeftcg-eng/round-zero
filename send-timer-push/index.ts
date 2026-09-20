// Edge Function: send-timer-push
//
// Called ONLY by the database (pg_net, from the timer_action / check_timer_alerts
// functions) whenever a timer hits a milestone. Looks up everyone who subscribed to
// push alerts for that timer and sends each a real browser notification.
//
// Callers can only pick an EVENT NAME — the notification text is fixed below — and
// must present the shared secret. Deploy with "Verify JWT" turned OFF (the secret
// is the authentication; see SETUP.md).
//
// Required secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_SHARED_SECRET
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:example@example.com";
const pushSecret = Deno.env.get("PUSH_SHARED_SECRET") || "";

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
const supabase = createClient(supabaseUrl, serviceRoleKey);

const MESSAGES: Record<string, string> = {
  start: "▶ Round started!",
  fifteen: "15 minutes into the round.",
  ten: "10 minutes remaining.",
  five: "5 minutes remaining.",
  extra: "Extra time has begun.",
  time_up: "Time is up! Please report your results to the judge.",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Same allowlist as push_subscribe() in the database: only real browser push services.
const ENDPOINT_RE =
  /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)\//;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Constant-time string comparison, so response timing can't be used to guess the secret.
function safeEqual(a: string, b: string) {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    if (!pushSecret || !safeEqual(req.headers.get("x-push-secret") || "", pushSecret)) {
      return json({ error: "unauthorized" }, 401);
    }

    let payload: { timer_id?: string; event?: string };
    try {
      payload = await req.json();
    } catch {
      return json({ skipped: true, reason: "invalid JSON" });
    }

    const { timer_id, event } = payload;
    if (!timer_id || !UUID_RE.test(timer_id)) return json({ skipped: true, reason: "bad timer_id" });
    const message = event ? MESSAGES[event] : undefined;
    if (!message) return json({ skipped: true, reason: "unknown event" });

    const { data: timer } = await supabase.from("timers").select("label").eq("id", timer_id).maybeSingle();
    if (!timer) return json({ sent: 0, reason: "no such timer" });

    const { data: subs, error } = await supabase
      .from("timer_push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("timer_id", timer_id);
    if (error) throw error;
    if (!subs || subs.length === 0) return json({ sent: 0 });

    const notification = JSON.stringify({
      title: (timer.label && String(timer.label).trim()) || "TurnZero",
      body: message,
      tag: "timer-" + timer_id,
      url: "/?view=" + timer_id,
      event,
    });

    let sent = 0;
    let failed = 0;
    const dead: string[] = [];

    // Send in parallel batches so a full room of subscribers is notified within a second or two.
    const BATCH = 50;
    for (let i = 0; i < subs.length; i += BATCH) {
      const results = await Promise.allSettled(
        subs.slice(i, i + BATCH).map((sub) => {
          if (!ENDPOINT_RE.test(sub.endpoint)) {
            dead.push(sub.id);
            return Promise.reject({ statusCode: 410 });
          }
          return webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            notification,
            { TTL: 600, urgency: "high" },
          );
        }),
      );
      results.forEach((r, idx) => {
        if (r.status === "fulfilled") {
          sent++;
        } else {
          failed++;
          const code = (r.reason as { statusCode?: number })?.statusCode;
          if (code === 404 || code === 410) {
            const id = subs[i + idx].id;
            if (!dead.includes(id)) dead.push(id);
          } else {
            console.error("push send failed:", code, String((r.reason as Error)?.message || ""));
          }
        }
      });
    }

    if (dead.length) await supabase.from("timer_push_subscriptions").delete().in("id", dead);

    console.log(`send-timer-push: ${event} sent ${sent}/${subs.length} for timer ${timer_id} (removed ${dead.length} dead)`);
    return json({ sent, failed, removed: dead.length });
  } catch (err) {
    console.error("send-timer-push top-level error:", err);
    return json({ error: "internal error" }, 500);
  }
});
