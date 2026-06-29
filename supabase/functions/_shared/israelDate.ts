// Israel-local calendar date helpers for DATE-column comparisons (guests.arrival_date).

export function israelTodayYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

export function isArrivalTodayIsrael(arrivalDateStr: string | null | undefined): boolean {
  if (!arrivalDateStr) return false;
  return arrivalDateStr === israelTodayYmd();
}
