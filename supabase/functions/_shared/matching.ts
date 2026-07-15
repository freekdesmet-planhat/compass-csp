// Entity matching helpers shared by all inbound integrations.
//   email → contact/company : participant email → contacts.email/other_emails
//                             → company; else domain match on companies.domains
//                             (excluding ORG_EMAIL_DOMAIN + freemail); ambiguous
//                             domain (multiple companies) → all, meta.ambiguous.
//   phone → contact         : E.164 normalise, match contacts.phone.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const FREEMAIL_DOMAINS = new Set([
  "gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com",
  "aol.com", "proton.me", "protonmail.com", "gmx.com", "live.com",
  "msn.com", "me.com", "mac.com", "ymail.com", "yandex.com", "zoho.com",
  "mail.com", "fastmail.com",
]);

export function orgDomain(): string {
  return (Deno.env.get("ORG_EMAIL_DOMAIN") ?? "").toLowerCase();
}

export function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  return email.slice(at + 1).trim().toLowerCase().replace(/>$/, "");
}

export function normaliseEmail(raw: string): string {
  // strip display name: "Jane Doe <jane@x.com>" → jane@x.com
  const m = raw.match(/<([^>]+)>/);
  const e = (m ? m[1] : raw).trim().toLowerCase();
  return e;
}

export interface MatchResult {
  companyIds: string[];
  contactIds: string[];
  ambiguous: boolean;
}

// Match a set of participant emails to companies + contacts.
export async function matchEmails(
  supabase: SupabaseClient,
  emails: string[],
): Promise<MatchResult> {
  const cleaned = Array.from(
    new Set(emails.map(normaliseEmail).filter((e) => e.includes("@"))),
  );
  const org = orgDomain();

  const companyIds = new Set<string>();
  const contactIds = new Set<string>();

  // 1. Direct contact match (email or other_emails).
  if (cleaned.length) {
    const { data: byEmail } = await supabase
      .from("contacts")
      .select("id, company_id, email, other_emails")
      .in("email", cleaned);
    for (const c of byEmail ?? []) {
      contactIds.add(c.id);
      if (c.company_id) companyIds.add(c.company_id);
    }
    // other_emails is an array column — check overlap per email.
    for (const e of cleaned) {
      const { data: byOther } = await supabase
        .from("contacts")
        .select("id, company_id")
        .contains("other_emails", [e]);
      for (const c of byOther ?? []) {
        contactIds.add(c.id);
        if (c.company_id) companyIds.add(c.company_id);
      }
    }
  }

  // 2. Domain fallback for external, non-freemail domains.
  const externalDomains = Array.from(
    new Set(
      cleaned
        .map(domainOf)
        .filter((d): d is string => !!d && d !== org && !FREEMAIL_DOMAINS.has(d)),
    ),
  );

  let ambiguous = false;
  for (const d of externalDomains) {
    const { data: byDomain } = await supabase
      .from("companies")
      .select("id")
      .contains("domains", [d]);
    const hits = byDomain ?? [];
    if (hits.length > 1) ambiguous = true; // multiple companies share this domain
    for (const co of hits) companyIds.add(co.id);
  }

  return {
    companyIds: Array.from(companyIds),
    contactIds: Array.from(contactIds),
    ambiguous,
  };
}

// Normalise a raw phone number toward E.164 (best-effort without a full lib).
export function normalisePhone(raw: string, defaultCountryCode = ""): string | null {
  if (!raw) return null;
  let s = raw.trim();
  const hasPlus = s.startsWith("+");
  s = s.replace(/[^\d]/g, "");
  if (!s) return null;
  if (hasPlus) return "+" + s;
  // 00 international prefix → +
  if (s.startsWith("00")) return "+" + s.slice(2);
  if (defaultCountryCode) return "+" + defaultCountryCode + s.replace(/^0+/, "");
  return "+" + s;
}

export interface PhoneMatch {
  contactId: string | null;
  companyId: string | null;
}

// Match a phone number to a contact (and its company). Tries E.164 and a
// last-9-digits suffix comparison to survive formatting differences.
export async function matchPhone(
  supabase: SupabaseClient,
  rawPhone: string,
): Promise<PhoneMatch> {
  const e164 = normalisePhone(rawPhone);
  if (!e164) return { contactId: null, companyId: null };

  // exact E.164
  const { data: exact } = await supabase
    .from("contacts")
    .select("id, company_id, phone")
    .eq("phone", e164)
    .limit(1);
  if (exact && exact.length) return { contactId: exact[0].id, companyId: exact[0].company_id };

  // suffix fallback: compare last 9 significant digits
  const suffix = e164.replace(/\D/g, "").slice(-9);
  if (suffix.length >= 7) {
    const { data: candidates } = await supabase
      .from("contacts")
      .select("id, company_id, phone")
      .not("phone", "is", null)
      .ilike("phone", `%${suffix}%`)
      .limit(5);
    const hit = (candidates ?? []).find(
      (c) => (c.phone ?? "").replace(/\D/g, "").slice(-9) === suffix,
    );
    if (hit) return { contactId: hit.id, companyId: hit.company_id };
  }
  return { contactId: null, companyId: null };
}
