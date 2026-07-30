import {
  getCheckinScopeCacheKey,
  guestsPageMemoryCache,
  readCachedCheckinScope,
  writeCachedCheckinScope,
} from "./checkinGuestsFetch";
import { CHECKIN_TIMELINE_TODAY } from "./guestCheckinMatrix";

describe("checkinGuestsFetch cache", () => {
  beforeEach(() => {
    guestsPageMemoryCache.guestsByScope = {};
    guestsPageMemoryCache.suiteRoomsByScope = {};
    guestsPageMemoryCache.scopeCounts = null;
    guestsPageMemoryCache.scopeCountsAt = 0;
  });

  it("builds stable scope cache keys", () => {
    expect(getCheckinScopeCacheKey(CHECKIN_TIMELINE_TODAY, null)).toBe("scope:today");
    expect(getCheckinScopeCacheKey(CHECKIN_TIMELINE_TODAY, "2026-08-01")).toBe("date:2026-08-01");
  });

  it("restores empty roster scopes from cache", () => {
    writeCachedCheckinScope(CHECKIN_TIMELINE_TODAY, null, {
      guests: [],
      suiteRoomsByGuestId: {},
    });
    const cached = readCachedCheckinScope(CHECKIN_TIMELINE_TODAY, null);
    expect(cached).not.toBeNull();
    expect(cached.guests).toEqual([]);
  });
});
