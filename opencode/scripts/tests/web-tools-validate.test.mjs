import { test, expect, describe } from "bun:test";
import {
  ValidationError,
  validateQuery,
  validateUrls,
  validateLatLng,
  clampCount,
  isSafePublicUrl,
  isPrivateOrUnsafeHost,
  truncateErrorBody,
  markUntrusted,
  UNTRUSTED_NOTICE,
  MAX_QUERY_LENGTH,
  MAX_URLS,
} from "../../plugins/web-tools/util/validate.ts";

describe("validateQuery", () => {
  test("accepts normal string", () => {
    expect(validateQuery("hello world")).toBe("hello world");
  });

  test("rejects empty string", () => {
    expect(() => validateQuery("")).toThrow(ValidationError);
  });

  test("rejects non-string", () => {
    expect(() => validateQuery(42)).toThrow(ValidationError);
  });

  test("rejects too-long string", () => {
    expect(() => validateQuery("a".repeat(MAX_QUERY_LENGTH + 1))).toThrow(ValidationError);
  });

  test("accepts exactly MAX_QUERY_LENGTH", () => {
    expect(validateQuery("a".repeat(MAX_QUERY_LENGTH))).toHaveLength(MAX_QUERY_LENGTH);
  });
});

describe("clampCount", () => {
  test("falls back when undefined", () => {
    expect(clampCount(undefined, 5)).toBe(5);
  });

  test("clamps below min", () => {
    expect(clampCount(0, 5)).toBe(1);
    expect(clampCount(-10, 5)).toBe(1);
  });

  test("clamps above max", () => {
    expect(clampCount(100, 5)).toBe(20);
  });

  test("passes through valid integer", () => {
    expect(clampCount(7, 5)).toBe(7);
  });

  test("truncates fractional", () => {
    expect(clampCount(7.9, 5)).toBe(7);
  });

  test("coerces string number", () => {
    expect(clampCount("3", 5)).toBe(3);
  });

  test("non-finite falls back", () => {
    expect(clampCount(NaN, 5)).toBe(5);
    expect(clampCount(Infinity, 5)).toBe(5);
  });
});

describe("isPrivateOrUnsafeHost", () => {
  test("blocks loopback names", () => {
    expect(isPrivateOrUnsafeHost("localhost")).toBe(true);
    expect(isPrivateOrUnsafeHost("LOCALHOST")).toBe(true);
  });

  test("blocks RFC1918 IPv4", () => {
    expect(isPrivateOrUnsafeHost("10.0.0.1")).toBe(true);
    expect(isPrivateOrUnsafeHost("172.16.0.1")).toBe(true);
    expect(isPrivateOrUnsafeHost("192.168.1.1")).toBe(true);
  });

  test("blocks link-local", () => {
    expect(isPrivateOrUnsafeHost("169.254.169.254")).toBe(true);
  });

  test("blocks 100.64/10 carrier-grade NAT", () => {
    expect(isPrivateOrUnsafeHost("100.64.0.1")).toBe(true);
  });

  test("blocks 0.0.0.0", () => {
    expect(isPrivateOrUnsafeHost("0.0.0.0")).toBe(true);
  });

  test("blocks IPv6 loopback", () => {
    expect(isPrivateOrUnsafeHost("::1")).toBe(true);
    expect(isPrivateOrUnsafeHost("::")).toBe(true);
  });

  test("blocks link-local IPv6", () => {
    expect(isPrivateOrUnsafeHost("fe80::1")).toBe(true);
  });

  test("blocks metadata.google.internal", () => {
    expect(isPrivateOrUnsafeHost("metadata.google.internal")).toBe(true);
  });

  test("blocks .internal suffix", () => {
    expect(isPrivateOrUnsafeHost("api.internal")).toBe(true);
    expect(isPrivateOrUnsafeHost("vault.internal")).toBe(true);
  });

  test("allows public hosts", () => {
    expect(isPrivateOrUnsafeHost("example.com")).toBe(false);
    expect(isPrivateOrUnsafeHost("api.openai.com")).toBe(false);
    expect(isPrivateOrUnsafeHost("8.8.8.8")).toBe(false);
    expect(isPrivateOrUnsafeHost("1.1.1.1")).toBe(false);
  });
});

describe("isSafePublicUrl", () => {
  test("accepts https public URL", () => {
    const r = isSafePublicUrl("https://example.com/path?q=1");
    expect(r.ok).toBe(true);
  });

  test("accepts http public URL", () => {
    const r = isSafePublicUrl("http://example.com/");
    expect(r.ok).toBe(true);
  });

  test("rejects loopback URL", () => {
    const r = isSafePublicUrl("http://localhost/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("loopback");
  });

  test("rejects private IP URL", () => {
    const r = isSafePublicUrl("http://10.0.0.1/");
    expect(r.ok).toBe(false);
  });

  test("rejects non-http(s) protocol", () => {
    expect(isSafePublicUrl("file:///etc/passwd").ok).toBe(false);
    expect(isSafePublicUrl("javascript:alert(1)").ok).toBe(false);
    expect(isSafePublicUrl("ftp://example.com/").ok).toBe(false);
  });

  test("rejects URL starting with '-'", () => {
    expect(isSafePublicUrl("-rsh://example.com").ok).toBe(false);
  });

  test("rejects too-long URL", () => {
    const huge = "https://example.com/" + "a".repeat(2100);
    expect(isSafePublicUrl(huge).ok).toBe(false);
  });

  test("rejects empty URL", () => {
    expect(isSafePublicUrl("").ok).toBe(false);
  });

  test("rejects metadata service URL", () => {
    const r = isSafePublicUrl("http://metadata.google.internal/computeMetadata/v1/");
    expect(r.ok).toBe(false);
  });
});

describe("validateUrls", () => {
  test("accepts up to MAX_URLS valid URLs", () => {
    const urls = Array.from({ length: MAX_URLS }, (_, i) => `https://example.com/page${i}`);
    expect(validateUrls(urls)).toHaveLength(MAX_URLS);
  });

  test("rejects more than MAX_URLS", () => {
    const urls = Array.from({ length: MAX_URLS + 1 }, (_, i) => `https://example.com/page${i}`);
    expect(() => validateUrls(urls)).toThrow(ValidationError);
  });

  test("rejects empty array", () => {
    expect(() => validateUrls([])).toThrow(ValidationError);
  });

  test("rejects non-array", () => {
    expect(() => validateUrls("not an array")).toThrow(ValidationError);
  });

  test("rejects any URL in the list that is unsafe", () => {
    expect(() => validateUrls(["https://example.com", "http://localhost/"])).toThrow(ValidationError);
  });
});

describe("validateLatLng", () => {
  test("accepts valid coords", () => {
    expect(validateLatLng(35.6762, 139.6503)).toEqual({ lat: 35.6762, lng: 139.6503 });
  });

  test("accepts undefined coords (no-op)", () => {
    expect(validateLatLng(undefined, undefined)).toEqual({});
  });

  test("rejects out-of-range lat", () => {
    expect(() => validateLatLng(91, 0)).toThrow(ValidationError);
    expect(() => validateLatLng(-91, 0)).toThrow(ValidationError);
  });

  test("rejects out-of-range lng", () => {
    expect(() => validateLatLng(0, 181)).toThrow(ValidationError);
    expect(() => validateLatLng(0, -181)).toThrow(ValidationError);
  });

  test("rejects non-finite", () => {
    expect(() => validateLatLng(NaN, 0)).toThrow(ValidationError);
    expect(() => validateLatLng(0, Infinity)).toThrow(ValidationError);
  });

  test("accepts string number", () => {
    expect(validateLatLng("35.5", "139.7")).toEqual({ lat: 35.5, lng: 139.7 });
  });
});

describe("truncateErrorBody", () => {
  test("passes through short text", () => {
    expect(truncateErrorBody("short")).toBe("short");
  });

  test("truncates long text with marker", () => {
    const result = truncateErrorBody("a".repeat(1000));
    expect(result.length).toBeLessThan(1000);
    expect(result).toContain("truncated");
  });

  test("returns empty for empty", () => {
    expect(truncateErrorBody("")).toBe("");
  });
});

describe("markUntrusted", () => {
  test("adds _untrusted: true", () => {
    const result = markUntrusted({ url: "x", content: "y" });
    expect(result._untrusted).toBe(true);
  });

  test("does not modify content string (preserves public shape)", () => {
    const result = markUntrusted({ url: "x", content: "sensitive" });
    expect(result.content).toBe("sensitive");
    expect(UNTRUSTED_NOTICE).toBeDefined();
  });

  test("preserves all other fields", () => {
    const result = markUntrusted({ a: 1, b: "x", c: true });
    expect(result.a).toBe(1);
    expect(result.b).toBe("x");
    expect(result.c).toBe(true);
    expect(result._untrusted).toBe(true);
  });
});
