import { describe, expect, test } from "bun:test";
import { deserializeSessionIndex, serializeSessionIndex, type SessionIndex } from "../src/dashboard/session-index.ts";

describe("session index serialization", () => {
  test("round-trips active and archived rows", () => {
    const index: SessionIndex = { active: new Map(), archived: new Map(), activeByDir: new Map(), archivedByDir: new Map() };
    const raw = serializeSessionIndex(index);
    const roundTrip = deserializeSessionIndex(raw);
    expect(roundTrip.active.size).toBe(0);
    expect(roundTrip.archived.size).toBe(0);
  });
});
