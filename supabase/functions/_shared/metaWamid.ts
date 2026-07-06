/** Extract Meta WhatsApp message id (wamid) from Graph API JSON response. */
export function extractWamidFromMetaResponse(responseText: string): string | null {
  try {
    const data = JSON.parse(responseText) as Record<string, unknown>;
    const messages = data.messages as Array<{ id?: string }> | undefined;
    const id = messages?.[0]?.id;
    return typeof id === "string" && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

/** Fail closed on ghost sends — returns the accepted wamid. */
export function assertMetaMessageAccepted(
  responseText: string,
  httpStatus: number,
  context: string,
): string {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    throw new Error(
      `${context}: HTTP ${httpStatus} but response is not JSON — body=${responseText.slice(0, 300)}`,
    );
  }
  const wamid = extractWamidFromMetaResponse(responseText);
  if (wamid) {
    console.log(`[meta] accepted ${context} wamid=${wamid}`);
    return wamid;
  }
  const errObj = data.error as Record<string, unknown> | undefined;
  const errMsg = errObj
    ? String(errObj.message ?? errObj.error_user_msg ?? JSON.stringify(errObj))
    : responseText.slice(0, 300);
  throw new Error(
    `${context}: HTTP ${httpStatus} but no messages[0].id (possible ghost send) — ${errMsg}`,
  );
}
