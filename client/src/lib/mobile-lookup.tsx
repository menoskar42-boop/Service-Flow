import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Phone } from "lucide-react";

export const phoneLookupKey = (raw: string | null | undefined): string => {
  const digits = String(raw ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return digits.startsWith("88") && digits.length > 7 ? digits.slice(2) : digits;
};

export const dialMobile = (raw: string | null | undefined): string => {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("0") ? digits : `0${digits}`;
};

export function useMobileLookup(phones: Array<string | null | undefined>): Record<string, string> {
  const phoneKey = useMemo(
    () => Array.from(new Set(phones.map(phoneLookupKey).filter(Boolean))).sort().join("|"),
    [phones],
  );
  const { data } = useQuery({
    queryKey: ["/api/phone-lines/mobile-lookup", phoneKey],
    enabled: Boolean(phoneKey),
    queryFn: async () => {
      const response = await fetch("/api/phone-lines/mobile-lookup", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phones: phoneKey.split("|") }),
      });
      if (!response.ok) throw new Error("فشل تحميل أرقام الموبايل");
      const payload = await response.json() as { data?: Array<{ phone: string; mobile: string | null }> };
      return Object.fromEntries(
        (payload.data ?? [])
          .filter((row) => row.mobile)
          .map((row) => [phoneLookupKey(row.phone), String(row.mobile)]),
      ) as Record<string, string>;
    },
  });
  return data ?? {};
}

export function MobileValue({ mobile }: { mobile: string | null | undefined }) {
  const dial = dialMobile(mobile);
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap" dir="ltr">
      <span className="font-mono">{mobile || "-"}</span>
      {dial && (
        <a
          href={`tel:${dial}`}
          className="md:hidden inline-flex items-center justify-center rounded-full p-1 text-emerald-600 hover:bg-emerald-50"
          title={`اتصال بالعميل: ${dial}`}
          aria-label={`اتصال بالعميل: ${dial}`}
        >
          <Phone className="h-3.5 w-3.5" />
        </a>
      )}
    </span>
  );
}
