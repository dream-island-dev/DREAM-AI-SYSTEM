import {
  applyFieldDefaultsToProfiles,
  parseMappingMemory,
  packMappingMemory,
  isEmptyImportCell,
  isValidHmTime,
  isDefaultEditableField,
  SUITE_ARRIVALS_SCHEMA,
  detectEzgoArrivalsPreset,
  normalizeImportRows,
  normalizeImportHeaderKey,
  isMappingUsable,
  resolveImportMapping,
  matrixRowsFromHeaderScan,
  diagnoseEzgoPresetMiss,
} from "./importMapper";

describe("importMapper — field defaults", () => {
  test("isEmptyImportCell treats dash placeholders as empty", () => {
    expect(isEmptyImportCell(null)).toBe(true);
    expect(isEmptyImportCell("-")).toBe(true);
    expect(isEmptyImportCell("—")).toBe(true);
    expect(isEmptyImportCell("15:00")).toBe(false);
  });

  test("isValidHmTime accepts HH:MM 24h", () => {
    expect(isValidHmTime("15:00")).toBe(true);
    expect(isValidHmTime("9:30")).toBe(true);
    expect(isValidHmTime("25:00")).toBe(false);
    expect(isValidHmTime("abc")).toBe(false);
  });

  test("isDefaultEditableField — times + defaultPolicy fields only", () => {
    expect(isDefaultEditableField("checkinTime", SUITE_ARRIVALS_SCHEMA.checkinTime)).toBe(true);
    expect(isDefaultEditableField("remark", SUITE_ARRIVALS_SCHEMA.remark)).toBe(false);
    expect(isDefaultEditableField("adults", SUITE_ARRIVALS_SCHEMA.adults)).toBe(true);
  });

  test("applyFieldDefaultsToProfiles fills empty room cells only", () => {
    const profileMap = new Map([
      ["row_0", {
        rooms: [
          { checkinTime: null, checkoutTime: "10:00", adults: 2 },
        ],
      }],
    ]);
    applyFieldDefaultsToProfiles(profileMap, {
      checkinTime: "15:00",
      checkoutTime: "11:00",
    });
    const room = profileMap.get("row_0").rooms[0];
    expect(room.checkinTime).toBe("15:00");
    expect(room.checkoutTime).toBe("10:00");
  });

  test("parseMappingMemory + packMappingMemory v2 round-trip", () => {
    const mapping = { remark: "sRemark", orderNumber: "iOrderId" };
    const fieldDefaults = { checkinTime: "15:00", checkoutTime: "11:00" };
    const packed = packMappingMemory(mapping, fieldDefaults);
    expect(packed.v).toBe(2);
    const parsed = parseMappingMemory(packed);
    expect(parsed.mapping).toEqual(mapping);
    expect(parsed.fieldDefaults).toEqual(fieldDefaults);
  });

  test("parseMappingMemory v1 flat mapping backward compat", () => {
    const flat = { remark: "sRemark" };
    const parsed = parseMappingMemory(flat);
    expect(parsed.mapping).toEqual(flat);
    expect(parsed.fieldDefaults).toEqual({});
  });
});

describe("importMapper — EZGO preset + header normalize", () => {
  test("normalizeImportHeaderKey strips BOM and spaces", () => {
    expect(normalizeImportHeaderKey("\ufeffiOrderId")).toBe("iOrderId");
    expect(normalizeImportHeaderKey(" sTel1 ")).toBe("sTel1");
  });

  test("detectEzgoArrivalsPreset matches BOM-prefixed Excel headers", () => {
    const headers = [
      "\ufeffiOrderId", "sTel1", "sRemark", "sClientFullName",
      "sSubItemName", "sRoomName", "iResLineId",
    ];
    expect(detectEzgoArrivalsPreset(headers)?.orderNumber).toBe("iOrderId");
  });

  test("normalizeImportRows rewrites keys for aggregateGuestProfiles", () => {
    const rows = normalizeImportRows([{ "\ufeffiOrderId": "99", " sTel1 ": "525" }]);
    expect(rows[0].iOrderId).toBe("99");
    expect(rows[0].sTel1).toBe("525");
  });

  test("isMappingUsable requires orderNumber + resLineId", () => {
    expect(isMappingUsable({ orderNumber: "iOrderId", resLineId: "iResLineId" })).toBe(true);
    expect(isMappingUsable({ orderNumber: "iOrderId" })).toBe(false);
    expect(isMappingUsable({})).toBe(false);
  });

  test("detectEzgoArrivalsPreset is case-insensitive on headers", () => {
    const headers = ["iorderid", "stel1", "sremark", "sclientfullname", "ssubitemname", "sroomname", "ireslineid"];
    expect(detectEzgoArrivalsPreset(headers)?.orderNumber).toBe("iorderid");
  });

  test("matrixRowsFromHeaderScan skips Excel title rows before EZGO headers", () => {
    const matrix = [
      ["דוח כניסות", "", ""],
      ["iOrderId", "sTel1", "sRemark", "sClientFullName", "sSubItemName", "sRoomName", "iResLineId"],
      ["266932", "0501112222", "יעקב 052-1234567", "קבוצה", "אמטיסט", "8", "9821345"],
    ];
    const hit = matrixRowsFromHeaderScan(matrix);
    expect(hit?.headerIdx).toBe(1);
    expect(hit?.rows).toHaveLength(1);
    expect(hit?.rows[0].iOrderId).toBe("266932");
  });

  // Hebrew-locale Excel tends to wrap ASCII column names in invisible
  // LRM/RLM direction marks (U+200E/U+200F) when a cell mixes RTL sheet
  // direction with LTR text — this broke the exact-string preset match and
  // silently dropped real EZGO files into the AI/manual-review screen.
  test("normalizeImportHeaderKey strips embedded LRM/RLM direction marks", () => {
    expect(normalizeImportHeaderKey("‏iOrderId‎")).toBe("iOrderId");
    expect(normalizeImportHeaderKey("sTel‏1")).toBe("sTel1");
  });

  test("detectEzgoArrivalsPreset matches headers with embedded direction marks", () => {
    const headers = [
      "‏iOrderId", "sTel‏1", "sRemark", "sClientFullName",
      "sSubItemName", "sRoomName", "iResLineId‎",
    ];
    const preset = detectEzgoArrivalsPreset(headers);
    expect(preset?.orderNumber).toBe("iOrderId");
    expect(preset?.resLineId).toBe("iResLineId");
  });

  test("diagnoseEzgoPresetMiss reports missing EZGO columns for FAIL VISIBLE banner", () => {
    const headers = ["iOrderId", "sTel1", "שם מלא"];
    const diag = diagnoseEzgoPresetMiss(headers);
    expect(diag.matchedCount).toBe(2);
    expect(diag.missing).toEqual(
      expect.arrayContaining(["sRemark", "sClientFullName", "sSubItemName", "sRoomName", "iResLineId"]),
    );
    expect(diag.headers).toEqual(["iOrderId", "sTel1", "שם מלא"]);
  });
});
