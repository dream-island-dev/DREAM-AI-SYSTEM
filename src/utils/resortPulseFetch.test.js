import { fetchGuestsForResortPulse, RESORT_PULSE_GUEST_PAGE_SIZE } from "./resortPulseFetch";

describe("fetchGuestsForResortPulse", () => {
  it("paginates past the PostgREST page size until a short page", async () => {
    const page1 = Array.from({ length: RESORT_PULSE_GUEST_PAGE_SIZE }, (_, i) => ({ id: i + 1 }));
    const page2 = [{ id: RESORT_PULSE_GUEST_PAGE_SIZE + 1 }];
    let calls = 0;
    const supabase = {
      from() {
        return {
          select() {
            return this;
          },
          gte() {
            return this;
          },
          order() {
            return this;
          },
          async range(from) {
            calls += 1;
            if (from === 0) return { data: page1, error: null };
            return { data: page2, error: null };
          },
        };
      },
    };

    const result = await fetchGuestsForResortPulse(supabase);
    expect(calls).toBe(2);
    expect(result.guests).toHaveLength(RESORT_PULSE_GUEST_PAGE_SIZE + 1);
    expect(result.pageCount).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it("stops on first short page", async () => {
    const supabase = {
      from() {
        return {
          select() {
            return this;
          },
          gte() {
            return this;
          },
          order() {
            return this;
          },
          async range() {
            return { data: [{ id: 1 }, { id: 2 }], error: null };
          },
        };
      },
    };

    const result = await fetchGuestsForResortPulse(supabase);
    expect(result.guests).toHaveLength(2);
    expect(result.pageCount).toBe(1);
  });
});
