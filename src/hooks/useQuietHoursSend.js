import { useCallback, useState } from "react";
import { isIsraelQuietHours, QUIET_HOURS_HINT, QUIET_HOURS_LABEL } from "../utils/quietHours";

/**
 * Gate manual staff-initiated whatsapp-send invokes during Israel quiet hours.
 * Returns canSend=false until override checkbox is checked.
 */
export function useQuietHoursSend() {
  const [overrideChecked, setOverrideChecked] = useState(false);

  const quietActive = isIsraelQuietHours();
  const canSend = !quietActive || overrideChecked;

  const ensureCanSend = useCallback(() => {
    if (isIsraelQuietHours() && !overrideChecked) {
      return false;
    }
    return true;
  }, [overrideChecked]);

  const resetOverride = useCallback(() => setOverrideChecked(false), []);

  return {
    quietActive,
    overrideChecked,
    setOverrideChecked,
    canSend,
    ensureCanSend,
    resetOverride,
    QUIET_HOURS_LABEL,
    QUIET_HOURS_HINT,
  };
}
