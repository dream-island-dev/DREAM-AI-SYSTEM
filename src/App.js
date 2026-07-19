import { useState, useEffect, useCallback } from "react";
import { initGoogleSignIn } from "./googleAuth";
import AgentQuestionnaire from "./components/AgentQuestionnaire";
import InventoryHub from "./components/InventoryHub";
import AdminPanel from "./components/AdminPanel";
import UserManagement from "./components/UserManagement";
import GuestsPage from "./components/GuestsPage";
import ShiftGenerator from "./components/ShiftGenerator";
import ShiftScheduleTab from "./components/ShiftScheduleTab";
import EmployeesPage from "./components/EmployeesPage";
import { isAdminUser, isSuperAdmin, loadDepartments, isGoogleAuthAllowed } from "./utils/admin";
import { canAccessRoute, canPerform, canSeeNavItem, filterNavItemsForUser, isRestaurantFocusedUser, RESTAURANT_FOCUS_NAV_IDS } from "./utils/auth";
import {
  ONBOARDING_DEPARTMENTS,
  RESTAURANT_DEPARTMENT,
  isRestaurantDepartment,
} from "./data/hotelDepartments";
import OperationalDashboard from "./components/OperationalDashboard";
import OritCustomerServicePanel from "./components/OritCustomerServicePanel";
import { consumeStaffDeepLink } from "./utils/staffDeepLink";
import { saveCheckinFilter } from "./utils/checkinFilterStorage";
import { supabase, isSupabaseConfigured, loadAgentProfile } from "./supabaseClient";
import { getPushState, subscribeToPush, unsubscribeFromPush, syncSubscriptionToSupabase } from "./utils/pushNotifications";
import KnowledgeUploader from "./components/KnowledgeUploader";
import GuestDashboard from "./components/GuestDashboard";
import BroadcastDashboard from "./components/BroadcastDashboard";
import WhatsAppInbox from "./components/WhatsAppInbox";
import OperationsBoard from "./components/OperationsBoard";
import BotConfigPanel from "./components/BotConfigPanel";
import BotSettings from "./components/BotSettings";
import ExecutivePlaybook from "./components/ExecutivePlaybook";
import BotScriptEditor from "./components/BotScriptEditor";
import AutomationControlCenter from "./components/AutomationControlCenter";
import RoomBoard from "./components/RoomBoard";
import HousekeepingTabletView from "./components/HousekeepingTabletView";
import RequestsBoard from "./components/RequestsBoard";
import SpaBoard from "./components/SpaBoard";
import GuestFeedbackTabs from "./components/GuestFeedbackTabs";
import PasswordChangeScreen from "./components/PasswordChangeScreen";
import SpaStagingPanel from "./components/SpaStagingPanel";
import AICopilot from "./components/AICopilot";
import RequestsAlertWidget from "./components/RequestsAlertWidget";
import AiFailoverWidget from "./components/AiFailoverWidget";
import SuitesDashboard from "./components/SuitesDashboard";
import DataSyncPage from "./components/DataSyncPage";
import PortalSettingsPanel from "./components/PortalSettingsPanel";
import CMSGate from "./components/cms/CMSGate";
import CMSSecurityPanel from "./components/cms/CMSSecurityPanel";
import VoucherReconciliationHub from "./components/VoucherReconciliationHub";
import ResortPulseBar from "./components/ResortPulseBar";
import GlobalCommandPalette from "./components/GlobalCommandPalette";
import RoutingControlCenter from "./components/RoutingControlCenter";
import AdminChangelogDashboard from "./components/AdminChangelogDashboard";
import ReceptionChecklist from "./components/ReceptionChecklist";
import RestaurantDinnerBoard from "./components/RestaurantDinnerBoard";
import RestaurantKioskShell from "./components/RestaurantKioskShell";

// ============================================================
// Departments are editable by admin via AdminPanel — stored in localStorage
const DEPARTMENTS = loadDepartments();

const initialEmployees = [
  {
    id: 1,
    name: "דנה מזרחי",
    department: "קבלה",
    role: "מנהלת משמרת",
    phone: "050-1234567",
    status: "פעיל",
  },
  {
    id: 2,
    name: "אלון שפירא",
    department: "תחזוקה",
    role: "טכנאי",
    phone: "052-2345678",
    status: "פעיל",
  },
  {
    id: 3,
    name: "מיה גולדברג",
    department: "מסעדה",
    role: "מלצרית",
    phone: "054-3456789",
    status: "פעיל",
  },
  {
    id: 4,
    name: "רון כץ",
    department: "ניקיון",
    role: "מנקה",
    phone: "058-4567890",
    status: "פעיל",
  },
  {
    id: 5,
    name: "נועה בן דוד",
    department: "ספא",
    role: "מטפלת",
    phone: "050-5678901",
    status: "פעיל",
  },
  {
    id: 6,
    name: "עמית ישראלי",
    department: "ביטחון",
    role: "שומר",
    phone: "052-6789012",
    status: "פעיל",
  },
];

const todayStr = new Date().toISOString().split("T")[0];

const initialShifts = [
  {
    id: 1,
    employeeId: 1,
    employeeName: "דנה מזרחי",
    department: "קבלה",
    date: todayStr,
    start: "08:00",
    end: "16:00",
    status: "פעיל",
  },
  {
    id: 2,
    employeeId: 2,
    employeeName: "אלון שפירא",
    department: "תחזוקה",
    date: todayStr,
    start: "07:00",
    end: "15:00",
    status: "פעיל",
  },
  {
    id: 3,
    employeeId: 3,
    employeeName: "מיה גולדברג",
    department: "מסעדה",
    date: todayStr,
    start: "12:00",
    end: "20:00",
    status: "עתידי",
  },
  {
    id: 4,
    employeeId: 6,
    employeeName: "עמית ישראלי",
    department: "ביטחון",
    date: todayStr,
    start: "00:00",
    end: "08:00",
    status: "הסתיים",
  },
];

const initialChecklists = [
  {
    id: 1,
    task: "בדיקת לובי – ניקיון וסדר",
    department: "ניקיון",
    assignedTo: "רון כץ",
    done: true,
    time: "08:00",
  },
  {
    id: 2,
    task: "בדיקת בריכה – רמות כלור",
    department: "תחזוקה",
    assignedTo: "אלון שפירא",
    done: true,
    time: "07:30",
  },
  {
    id: 3,
    task: "הכנת חדר ארוחת בוקר",
    department: "מסעדה",
    assignedTo: "מיה גולדברג",
    done: false,
    time: "",
  },
  {
    id: 4,
    task: "בדיקת מצלמות אבטחה",
    department: "ביטחון",
    assignedTo: "עמית ישראלי",
    done: false,
    time: "",
  },
  {
    id: 5,
    task: "עדכון לוח הזמנות קבלה",
    department: "קבלה",
    assignedTo: "דנה מזרחי",
    done: true,
    time: "08:15",
  },
  {
    id: 6,
    task: "בדיקת מלאי חדרים – שמפו/סבון",
    department: "ניקיון",
    assignedTo: "רון כץ",
    done: false,
    time: "",
  },
];

// ============================================================
// helper: פענוח פרופיל Google מתוך ה-ID Token (לשלב הדמו בלבד —
// אימות מאובטח בצד-שרת מתבצע דרך ה-Apps Script בשלב הבא)
// ============================================================
function decodeJwt(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(json);
  } catch (e) {
    return {};
  }
}

// ============================================================
// DREAM ISLAND BRAND COLORS
// ============================================================
const css = `
  /* Heebo/Playfair Display now loaded via a <link> in public/index.html
     (not an @import here) — see that file's comment for why: this CSS
     string only ever runs once App.js mounts, which the public Guest
     Portal route (/portal/:token) never does. */

  @keyframes di-spin { to { transform: rotate(360deg); } }
  @keyframes slideUp {
    from { transform: translateY(100%); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }

  :root {
    /* ── Brand palette ── */
    --gold: #C9A96E;
    --gold-dark: #A8843A;
    --gold-light: #E8C98A;
    --gold-pale: #F5EDD8;
    --black: #1A1A1A;
    --black-soft: #2C2C2C;
    --ivory: #F5F0E8;
    --ivory-dark: #EDE5D5;
    --text-main: #1A1A1A;
    --text-muted: #8A7A6A;
    --border: #E0D5C5;
    --card-bg: #FFFFFF;
    --sidebar-bg: #0F0F0F;

    /* ── Semantic status (staff badge vocabulary — RESORT_UI_MANIFEST §1.2) ── */
    --status-success: #1A7A4A;
    --status-success-bg: #E8F5EF;
    --status-danger: #C0392B;
    --status-danger-bg: #FFF0EE;
    --status-warning: #B5600A;
    --status-warning-bg: #FFF5E8;
    --status-info: #2952A3;
    --status-info-bg: #EEF4FF;
    --status-purple: #5B21B6;
    --status-purple-bg: #F3F0FF;
    --error: var(--status-danger);
    --whatsapp-green: #128C7E;
    --whatsapp-green-dark: #075E54;

    /* ── Spacing scale ── */
    --space-xs: 4px;
    --space-sm: 8px;
    --space-md: 16px;
    --space-lg: 24px;
    --space-xl: 32px;
    --space-2xl: 48px;

    /* ── Radius ── */
    --radius-sm: 8px;
    --radius-md: 10px;
    --radius-lg: 14px;
    --radius-xl: 18px;
    --radius-pill: 20px;

    /* ── Elevation ── */
    --shadow-xs: 0 1px 6px rgba(0,0,0,0.06);
    --shadow-sm: 0 2px 12px rgba(0,0,0,0.05);
    --shadow-md: 0 6px 20px rgba(0,0,0,0.1);
    --shadow-lg: 0 32px 80px rgba(0,0,0,0.25);
    --shadow-gold: 0 2px 12px rgba(201,169,110,0.25);
    --focus-ring: 0 0 0 3px rgba(201,169,110,0.12);

    /* ── Touch / mobile shell (playbook §4.4) ── */
    --hit-target-staff: 44px;
    --hit-target-comfort: 48px;
    --hit-target-kiosk: 72px;
    --mobile-bar-height: 64px;
    --safe-bottom-nav: 80px;

    --transition-fast: 0.15s ease;
    --transition-base: 0.2s ease;
  }

  /* ── Phase 0 utilities — reuse in Phases 1–4 instead of one-off hex/spacing ── */
  .u-touch-staff { min-height: var(--hit-target-staff); min-width: var(--hit-target-staff); }
  .u-touch-comfort { min-height: var(--hit-target-comfort); min-width: var(--hit-target-comfort); }
  .u-touch-kiosk { min-height: var(--hit-target-kiosk); min-width: var(--hit-target-kiosk); }
  .u-safe-nav-pad { padding-bottom: var(--safe-bottom-nav); }
  .u-flex-between { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); }
  .u-flex-row { display: flex; align-items: center; gap: var(--space-sm); }
  .u-flex-col { display: flex; flex-direction: column; gap: var(--space-sm); }
  .u-gap-md { gap: var(--space-md); }
  .u-text-muted { color: var(--text-muted); }
  .u-text-main { color: var(--text-main); }
  .u-badge-nowrap { white-space: nowrap; }
  .u-min-h-0 { min-height: 0; }
  .u-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .u-shadow-sm { box-shadow: var(--shadow-sm); }
  .u-shadow-md { box-shadow: var(--shadow-md); }
  .u-muted-action { opacity: 0.45; cursor: not-allowed; }

  /* ── Resort Pulse + Command Palette (session 124) ── */
  .resort-pulse-bar {
    display: flex; align-items: center; gap: var(--space-sm); flex-wrap: wrap;
    padding: 8px var(--space-md); background: var(--card-bg);
    border-bottom: 1px solid var(--border);
  }
  .resort-pulse-bar__title { font-size: 11px; font-weight: 800; color: var(--text-muted); white-space: nowrap; }
  .resort-pulse-bar__chips { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; }
  .resort-pulse-bar__refresh {
    border: 1px solid var(--border); background: var(--ivory); border-radius: 8px;
    padding: 4px 8px; cursor: pointer; font-size: 14px;
  }
  .resort-pulse-bar__err { font-size: 11px; color: #DC2626; }
  .resort-pulse-chip {
    display: flex; align-items: center; gap: 6px; padding: 6px 10px;
    border-radius: 999px; border: 1px solid var(--border); background: var(--ivory);
    cursor: pointer; font-family: Heebo, sans-serif; transition: var(--transition-fast);
  }
  .resort-pulse-chip:hover { border-color: var(--gold); box-shadow: var(--shadow-gold); }
  .resort-pulse-chip--alert { border-color: #FCA5A5; background: #FEF2F2; }
  .resort-pulse-chip__emoji { font-size: 14px; }
  .resort-pulse-chip__value { font-weight: 800; font-size: 14px; color: var(--black); }
  .resort-pulse-chip__label { font-size: 11px; color: var(--text-muted); white-space: nowrap; }

  .cmd-palette-overlay {
    position: fixed; inset: 0; z-index: 2000;
    background: rgba(0,0,0,0.45); backdrop-filter: blur(3px);
    display: flex; align-items: flex-start; justify-content: center; padding-top: 12vh;
  }
  .cmd-palette {
    width: min(560px, 94vw); background: var(--card-bg); border-radius: 14px;
    box-shadow: var(--shadow-lg); overflow: hidden; direction: rtl;
  }
  .cmd-palette__input {
    width: 100%; border: none; border-bottom: 1px solid var(--border);
    padding: 16px 18px; font-size: 16px; font-family: Heebo, sans-serif;
    outline: none; background: var(--ivory);
  }
  .cmd-palette__list { list-style: none; max-height: 50vh; overflow-y: auto; margin: 0; padding: 6px; }
  .cmd-palette__item {
    width: 100%; text-align: right; border: none; background: transparent;
    padding: 10px 12px; border-radius: 8px; cursor: pointer;
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    font-family: Heebo, sans-serif; font-size: 14px;
  }
  .cmd-palette__item--active { background: rgba(201,169,110,0.15); }
  .cmd-palette__item-label { flex: 1; font-weight: 600; color: var(--black); }
  .cmd-palette__sub { font-size: 11px; color: var(--text-muted); direction: ltr; }
  .cmd-palette__badge { font-size: 10px; font-weight: 700; }
  .cmd-palette__empty { padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px; }
  .cmd-palette__hint { padding: 8px 18px; font-size: 12px; color: var(--text-muted); }
  .cmd-palette__footer {
    padding: 8px 14px; font-size: 10px; color: var(--text-muted);
    border-top: 1px solid var(--border); background: var(--ivory);
  }
  .topbar-cmd-btn {
    border: 1px solid var(--border); background: var(--card-bg); border-radius: 8px;
    padding: 5px 10px; cursor: pointer; font-size: 12px; font-weight: 700;
    color: var(--text-muted); font-family: Heebo, sans-serif; white-space: nowrap;
  }
  .topbar-cmd-btn:hover { border-color: var(--gold); color: var(--gold-dark); }

  @media (max-width: 768px) {
    .resort-pulse-chip__label { display: none; }
    .resort-pulse-bar__title { display: none; }
    .topbar-cmd-btn span.cmd-kbd { display: none; }
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Heebo', sans-serif; direction: rtl; }

  .app { min-height: 100vh; background: var(--ivory); }

  /* LOGIN */
  .login-bg {
    min-height: 100vh;
    background: linear-gradient(160deg, #0F0F0F 0%, #1A1A1A 50%, #2C2416 100%);
    display: flex; align-items: center; justify-content: center;
    padding: 20px; position: relative; overflow: hidden;
  }
  .login-bg::before {
    content: ''; position: absolute; inset: 0;
    background: radial-gradient(ellipse at 30% 50%, rgba(201,169,110,0.12) 0%, transparent 60%),
                radial-gradient(ellipse at 70% 20%, rgba(201,169,110,0.08) 0%, transparent 50%);
    pointer-events: none;
  }
  .login-card {
    background: rgba(255,255,255,0.04);
    backdrop-filter: blur(24px);
    border: 1px solid rgba(201,169,110,0.25);
    border-radius: 24px;
    padding: 48px 40px;
    width: 100%; max-width: 400px;
    box-shadow: 0 32px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(201,169,110,0.15);
    position: relative;
  }
  .login-logo { text-align: center; margin-bottom: 36px; }
  .login-logo .island { font-size: 44px; margin-bottom: 12px; }
  .login-logo h1 {
    color: var(--gold-light); font-size: 24px; font-weight: 700;
    font-family: 'Playfair Display', serif; letter-spacing: 0.5px;
  }
  .login-logo p { color: rgba(255,255,255,0.35); font-size: 12px; margin-top: 6px; letter-spacing: 2px; text-transform: uppercase; }
  .login-logo-img {
    display: block; width: 220px; max-width: 100%; margin: 0 auto;
    border-radius: 16px;
    box-shadow: 0 16px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(201,169,110,0.3), 0 0 36px rgba(201,169,110,0.14);
  }
  .login-divider { width: 40px; height: 1px; background: var(--gold); margin: 18px auto 0; opacity: 0.4; }
  .login-field { margin-bottom: 16px; }
  .login-field label { display: block; color: rgba(201,169,110,0.7); font-size: 12px; margin-bottom: 6px; font-weight: 600; letter-spacing: 0.5px; }
  .login-field input {
    width: 100%; padding: 14px 16px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(201,169,110,0.2);
    border-radius: 10px; color: #fff;
    font-family: 'Heebo', sans-serif; font-size: 15px;
    outline: none; transition: border 0.2s;
    direction: ltr; text-align: right;
  }
  .login-field input:focus { border-color: var(--gold); background: rgba(201,169,110,0.08); }
  .login-btn {
    width: 100%; padding: 16px;
    background: linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%);
    border: none; border-radius: 10px;
    color: #0F0F0F; font-family: 'Heebo', sans-serif;
    font-size: 15px; font-weight: 800;
    cursor: pointer; margin-top: 8px;
    transition: all 0.2s; letter-spacing: 0.5px;
    box-shadow: 0 4px 20px rgba(201,169,110,0.3);
  }
  .login-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 28px rgba(201,169,110,0.4); }
  .login-error { color: #ff8a80; font-size: 13px; text-align: center; margin-top: 12px; }
  .login-or { display: flex; align-items: center; gap: 12px; margin: 22px 0 6px; color: rgba(255,255,255,0.35); font-size: 12px; }
  .login-or::before, .login-or::after { content: ''; flex: 1; height: 1px; background: rgba(201,169,110,0.2); }
  .gsi-wrap { display: flex; justify-content: center; min-height: 44px; }

  /* LAYOUT */
  .layout { display: flex; min-height: 100vh; }
  .sidebar {
    width: 240px; min-width: 240px;
    background: var(--sidebar-bg);
    display: flex; flex-direction: column;
    padding: 0; position: fixed; height: 100vh;
    right: 0; z-index: 100; overflow-y: auto;
    border-left: 1px solid rgba(201,169,110,0.1);
  }
  .sidebar-header {
    padding: 24px 20px 20px;
    border-bottom: 1px solid rgba(201,169,110,0.12);
  }
  .sidebar-brand { margin-bottom: 16px; }
  .sidebar-brand-img {
    display: block; width: 100%; border-radius: 10px;
    box-shadow: 0 6px 18px rgba(0,0,0,0.45), 0 0 0 1px rgba(201,169,110,0.25);
  }
  .sidebar-user {
    display: flex; align-items: center; gap: 10px;
    background: rgba(201,169,110,0.08); border-radius: 10px;
    padding: 10px 12px; border: 1px solid rgba(201,169,110,0.12);
  }
  .avatar {
    width: 34px; height: 34px; border-radius: 50%;
    background: linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%);
    display: flex; align-items: center; justify-content: center;
    color: #0F0F0F; font-weight: 800; font-size: 12px; flex-shrink: 0;
  }
  .sidebar-user-info { flex: 1; min-width: 0; }
  .sidebar-user-name { color: #fff; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sidebar-user-role { color: var(--gold); font-size: 10px; font-weight: 500; }
  .sidebar-nav { padding: 16px 12px; flex: 1; }
  .nav-section { margin-bottom: 8px; }
  .nav-section-title { color: rgba(201,169,110,0.35); font-size: 10px; font-weight: 700; letter-spacing: 1.5px; padding: 0 8px; margin-bottom: 6px; text-transform: uppercase; }
  .nav-item {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 12px; border-radius: 8px;
    cursor: pointer; transition: all 0.2s;
    color: rgba(255,255,255,0.45); font-size: 14px;
    margin-bottom: 2px; border: none; background: none;
    width: 100%; text-align: right; font-family: 'Heebo', sans-serif;
  }
  .nav-item:hover { background: rgba(201,169,110,0.08); color: var(--gold-light); }
  .nav-item.active { background: rgba(201,169,110,0.12); color: var(--gold); border: 1px solid rgba(201,169,110,0.2); }
  .nav-item .icon { font-size: 17px; }
  .nav-badge {
    margin-right: auto; background: var(--status-danger);
    color: #fff; font-size: 10px; font-weight: 700;
    padding: 2px 6px; border-radius: 10px; min-width: 18px; text-align: center;
  }
  .sidebar-footer {
    padding: 16px 12px;
    border-top: 1px solid rgba(201,169,110,0.1);
  }
  .logout-btn {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 12px; border-radius: 8px;
    cursor: pointer; color: rgba(255,255,255,0.3);
    font-size: 13px; width: 100%; border: none;
    background: none; font-family: 'Heebo', sans-serif;
    transition: all 0.2s; text-align: right;
  }
  .logout-btn:hover { color: #ff8a80; background: rgba(255,107,107,0.08); }

  /* MAIN */
  /* min-width: 0 overrides the flex-item default of min-width:auto — without
     it, any deeply-nested wide content (e.g. a table with minWidth set for
     mobile horizontal scroll) pushes .main wider than the viewport instead
     of scrolling inside its own overflow-x:auto wrapper. */
  .main { margin-right: 240px; flex: 1; min-width: 0; min-height: 100vh; }
  .topbar {
    background: var(--card-bg); padding: 16px 28px;
    display: flex; align-items: center; justify-content: space-between;
    border-bottom: 1px solid var(--border);
    position: sticky; top: 0; z-index: 50;
    box-shadow: 0 2px 12px rgba(0,0,0,0.05);
  }
  /* Hamburger drawer trigger — hidden on desktop, shown only <=768px where
     .sidebar is display:none and the 5-item mobile-bar doesn't cover admin
     pages. Min 44px touch target. */
  .hamburger-btn {
    display: none; background: none; border: none; cursor: pointer;
    font-size: 22px; line-height: 1; color: var(--black);
    width: var(--hit-target-staff); height: var(--hit-target-staff);
    align-items: center; justify-content: center;
    border-radius: var(--radius-sm); flex-shrink: 0; margin-left: var(--space-sm);
  }
  .hamburger-btn:active { background: var(--ivory); }
  .sidebar-mobile-backdrop { display: none; }
  .topbar-title { font-size: 19px; font-weight: 800; color: var(--black); font-family: 'Playfair Display', serif; }
  .topbar-date { font-size: 12px; color: var(--text-muted); background: var(--ivory); padding: 5px 12px; border-radius: 20px; border: 1px solid var(--border); }
  .content {
    padding: var(--space-lg);
    max-width: 100%;
    box-sizing: border-box;
    overflow-x: hidden;
  }

  /* Check-in roster — desktop table scroll; mobile card stack (GuestsPage.js) */
  .checkin-table-wrap {
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .checkin-table-wrap .table { min-width: 880px; }
  .checkin-guest-cards { display: none; }
  .checkin-guest-card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-md);
    box-shadow: var(--shadow-sm);
  }
  .checkin-guest-card-header {
    display: flex; align-items: flex-start; gap: 10px;
    margin-bottom: 10px; min-width: 0;
  }
  .checkin-guest-card-meta {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 12px;
    font-size: 13px;
    margin-bottom: 12px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }
  .checkin-guest-card-meta dt {
    font-size: 10px; font-weight: 700; color: var(--text-muted);
    margin: 0 0 2px;
  }
  .checkin-guest-card-meta dd { margin: 0; font-weight: 600; min-width: 0; word-break: break-word; }
  .checkin-guest-card-actions {
    display: flex; flex-wrap: wrap; gap: 8px;
  }
  .checkin-guest-card-actions .btn { flex: 1 1 calc(50% - 4px); min-width: 0; justify-content: center; }

  /* CARDS */
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--space-md); margin-bottom: var(--space-lg); }
  .stat-card {
    background: var(--card-bg); border-radius: var(--radius-lg);
    padding: var(--space-lg); box-shadow: var(--shadow-sm);
    border: 1px solid var(--border);
    position: relative; overflow: hidden;
    display: flex; flex-direction: column; min-width: 0;
    transition: box-shadow var(--transition-base), transform var(--transition-base), border-color var(--transition-base);
  }
  .stat-card:hover {
    box-shadow: var(--shadow-md); transform: translateY(-1px);
    border-color: rgba(201,169,110,0.35);
  }
  .stat-card::before {
    content: ''; position: absolute; top: 0; right: 0; left: 0; height: 3px;
    background: linear-gradient(90deg, var(--gold-dark), var(--gold));
    opacity: 0.9;
  }
  .stat-card::after {
    content: ''; position: absolute; bottom: 0; left: 0;
    width: 72px; height: 72px;
    background: radial-gradient(circle, rgba(201,169,110,0.1) 0%, transparent 70%);
    pointer-events: none;
  }
  .stat-card--tasks::before { background: linear-gradient(90deg, var(--status-warning), var(--gold)); }
  .stat-card--requests::before { background: linear-gradient(90deg, var(--status-info), var(--gold-light)); }
  button.stat-card { font: inherit; color: inherit; width: 100%; }
  .stat-card--checklist::before { background: linear-gradient(90deg, var(--status-success), var(--gold-light)); }
  .stat-card--depts::before { background: linear-gradient(90deg, var(--status-info), var(--gold)); }
  .stat-card--shifts::before { background: linear-gradient(90deg, var(--gold-dark), var(--gold-light)); }
  .stat-card-header {
    display: flex; align-items: center; justify-content: space-between;
    gap: var(--space-sm); margin-bottom: var(--space-sm);
  }
  .stat-icon { font-size: 28px; line-height: 1; flex-shrink: 0; }
  .stat-value {
    font-size: 32px; font-weight: 900; color: var(--black); line-height: 1;
    font-family: 'Playfair Display', serif; letter-spacing: -0.02em;
  }
  .stat-label {
    font-size: 12px; color: var(--text-muted); margin-top: var(--space-xs);
    font-weight: 600; line-height: 1.35;
  }
  .stat-sub { font-size: 11px; margin-top: var(--space-xs); font-weight: 600; line-height: 1.3; }
  .stat-sub--success { color: var(--status-success); }
  .stat-sub--danger { color: var(--status-danger); }
  .stat-sub--info { color: var(--status-info); }
  .dashboard-urgent {
    background: linear-gradient(135deg, var(--status-danger-bg), var(--card-bg));
    border: 1px solid var(--status-danger-bg);
    border-radius: var(--radius-md);
    padding: var(--space-md) var(--space-lg);
    margin-bottom: var(--space-lg);
    display: flex; align-items: flex-start; gap: var(--space-sm);
    box-shadow: var(--shadow-xs);
  }
  .dashboard-urgent-title { font-weight: 700; color: var(--status-danger); font-size: 14px; }
  .dashboard-urgent-body { font-size: 13px; color: var(--text-muted); margin-top: 2px; line-height: 1.45; }

  /* Dashboard lower panels — shifts + recent tasks */
  .dash-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-lg); }
  .dash-grid .card { margin-bottom: 0; }
  .dash-grid .card-header {
    background: linear-gradient(180deg, var(--ivory) 0%, var(--card-bg) 100%);
    padding: 14px 20px;
  }
  .dash-list-row {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 20px; border-bottom: 1px solid var(--border);
  }
  .dash-list-row:last-child { border-bottom: none; }
  .dash-empty-state {
    padding: var(--space-lg); color: var(--text-muted);
    text-align: center; font-size: 13px; line-height: 1.5;
  }
  .dash-row-main { flex: 1; min-width: 0; }
  .dash-row-title { font-size: 13px; font-weight: 600; color: var(--text-main); }
  .dash-row-title--clip {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .dash-row-sub { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

  .card {
    background: var(--card-bg); border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    border: 1px solid var(--border); overflow: hidden;
    margin-bottom: var(--space-md);
  }
  .card-header {
    padding: 16px 20px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
    background: var(--card-bg);
  }
  .card-title { font-size: 15px; font-weight: 700; color: var(--black); }
  .card-body { padding: 0; }

  /* TABLE */
  .table { width: 100%; border-collapse: collapse; }
  .table th {
    background: var(--ivory); padding: 12px 16px;
    font-size: 11px; color: var(--text-muted); font-weight: 700;
    text-align: right; border-bottom: 1px solid var(--border);
    letter-spacing: 0.5px; text-transform: uppercase;
  }
  .table td { padding: 14px 16px; border-bottom: 1px solid #F5F0E8; font-size: 14px; color: var(--text-main); }
  .table tr:last-child td { border-bottom: none; }
  .table tr:hover td { background: #FDFAF5; }

  /* BADGES */
  .badge {
    display: inline-flex; align-items: center;
    padding: 3px 10px; border-radius: 20px;
    font-size: 11px; font-weight: 700;
  }
  .badge-green { background: var(--status-success-bg); color: var(--status-success); }
  .badge-red { background: var(--status-danger-bg); color: var(--status-danger); }
  .badge-orange { background: var(--status-warning-bg); color: var(--status-warning); }
  .badge-blue { background: var(--status-info-bg); color: var(--status-info); }
  .badge-gray { background: var(--ivory); color: var(--text-muted); border: 1px solid var(--border); }
  .badge-purple { background: var(--status-purple-bg); color: var(--status-purple); }
  .badge-gold { background: rgba(201,169,110,0.15); color: var(--gold-dark); border: 1px solid rgba(201,169,110,0.3); }

  /* PRIORITY */
  .dot-red { background: var(--status-danger); }
  .dot-orange { background: var(--status-warning); }
  .dot-green { background: var(--status-success); }

  /* BUTTONS */
  .btn {
    padding: 10px 18px; border-radius: var(--radius-sm);
    font-family: 'Heebo', sans-serif; font-size: 13px;
    font-weight: 700; cursor: pointer; border: none;
    transition: all var(--transition-base); display: inline-flex;
    align-items: center; gap: 6px;
    min-height: var(--hit-target-staff);
  }
  .btn-primary {
    background: linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%);
    color: #0F0F0F; box-shadow: var(--shadow-gold);
  }
  .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(201,169,110,0.35); }
  .btn-ghost { background: transparent; color: var(--text-muted); border: 1px solid var(--border); }
  .btn-ghost:hover { background: var(--ivory); color: var(--black); }
  .btn-danger { background: var(--status-danger-bg); color: var(--status-danger); }
  .btn-sm { padding: 6px 12px; font-size: 12px; }

  /* FORM */
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .form-field { margin-bottom: 16px; }
  .form-field label { display: block; font-size: 12px; color: var(--text-muted); font-weight: 700; margin-bottom: 6px; letter-spacing: 0.3px; }
  .form-field input, .form-field select, .form-field textarea {
    width: 100%; padding: 12px 14px;
    border: 1.5px solid var(--border); border-radius: 8px;
    font-family: 'Heebo', sans-serif; font-size: 14px;
    color: var(--text-main); outline: none; transition: border 0.2s;
    background: var(--card-bg);
  }
  .form-field input:focus, .form-field select:focus, .form-field textarea:focus {
    border-color: var(--gold); box-shadow: var(--focus-ring);
  }

  /* MODAL */
  .modal-overlay {
    position: fixed; inset: 0;
    background: rgba(15,15,15,0.7); backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000; padding: 20px;
  }
  .modal {
    background: var(--card-bg); border-radius: 18px;
    padding: 28px; width: 100%; max-width: 500px;
    max-height: 90vh; overflow-y: auto;
    box-shadow: 0 32px 80px rgba(0,0,0,0.25);
    border: 1px solid var(--border);
  }
  .modal-title { font-size: 18px; font-weight: 800; color: var(--black); margin-bottom: 20px; font-family: 'Playfair Display', serif; }

  /* KANBAN */
  .kanban { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .kanban-col { background: var(--ivory); border-radius: 12px; padding: 14px; border: 1px solid var(--border); }
  .kanban-col-title {
    font-size: 12px; font-weight: 700; margin-bottom: 12px;
    display: flex; align-items: center; gap: 8px;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .kanban-card {
    background: var(--card-bg); border-radius: 10px;
    padding: 14px; margin-bottom: 10px;
    box-shadow: 0 1px 6px rgba(0,0,0,0.06);
    border: 1px solid var(--border); cursor: pointer;
    transition: all 0.2s;
  }
  .kanban-card:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.1); border-color: var(--gold); }
  .kanban-card-title { font-size: 13px; font-weight: 700; color: var(--text-main); margin-bottom: 6px; }
  .kanban-card-meta { font-size: 11px; color: var(--text-muted); }

  /* CHECKLIST */
  .checklist-item {
    display: flex; align-items: center; gap: 14px;
    padding: 14px 20px; border-bottom: 1px solid #F5F0E8;
    transition: background 0.15s;
  }
  .checklist-item:hover { background: #FDFAF5; }
  .checklist-item:last-child { border-bottom: none; }
  .check-box {
    width: 22px; height: 22px; border-radius: 6px;
    border: 2px solid var(--border); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; transition: all 0.2s; background: var(--card-bg);
  }
  .check-box.checked { background: var(--gold); border-color: var(--gold-dark); }
  .check-text { flex: 1; font-size: 14px; color: var(--text-main); }
  .check-text.done { text-decoration: line-through; color: var(--text-muted); }
  .check-dept { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

  /* MOBILE */
  .mobile-bar {
    display: none; position: fixed; bottom: 0; left: 0; right: 0;
    background: var(--black); border-top: 1px solid rgba(201,169,110,0.15);
    padding: var(--space-sm) 0 calc(var(--space-sm) + env(safe-area-inset-bottom, 0px));
    z-index: 200;
    box-shadow: 0 -4px 20px rgba(0,0,0,0.2);
    min-height: var(--mobile-bar-height);
  }
  .mobile-nav { display: flex; justify-content: space-around; }
  .mobile-nav-item {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: var(--space-xs); cursor: pointer;
    padding: var(--space-xs) var(--space-md);
    min-height: var(--hit-target-staff); min-width: var(--hit-target-staff);
    border: none; background: none; font-family: 'Heebo', sans-serif;
    transition: all var(--transition-base); position: relative;
  }
  .mobile-nav-item .icon { font-size: 22px; }
  .mobile-nav-item .label { font-size: 10px; color: rgba(255,255,255,0.35); font-weight: 600; }
  .mobile-nav-item.active .label { color: var(--gold); }
  .mobile-nav-item.active .icon { filter: drop-shadow(0 0 4px rgba(201,169,110,0.5)); }

  /* PROGRESS */
  .progress-bar { height: 6px; background: var(--ivory-dark); border-radius: 4px; overflow: hidden; }
  .progress-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg, var(--gold-dark), var(--gold)); transition: width 0.5s; }

  /* SHIFT STATUS */
  .shift-active { border-right: 3px solid var(--gold); }
  .shift-future { border-right: 3px solid #2952A3; }
  .shift-done { border-right: 3px solid var(--border); }

  /* GOLD ACCENT LINE */
  .gold-line { width: 32px; height: 2px; background: var(--gold); border-radius: 2px; margin-bottom: 12px; }

  /* DASHBOARD two-column section grid — see .dash-grid rules above */

  @media (max-width: 768px) {
    .sidebar { display: none; }
    .main { margin-right: 0; padding-bottom: var(--safe-bottom-nav); }
    .mobile-bar { display: block; }
    .hamburger-btn { display: flex; }
    .topbar { padding: 14px 18px; }
    .topbar-date { display: none; } /* free up room for the account control */
    .content { padding: var(--space-md); }
    /* DREAM BOT Inbox — full-bleed on phone (no wasted padding / double chrome) */
    .content.content--wa-inbox {
      padding: 0;
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }
    .topbar.topbar--wa-inbox .topbar-title { display: none; }
    /* List screen: slim topbar to hamburger only — bell/account/logout stay
       reachable via the hamburger drawer (Sidebar already shows user+logout),
       no need to duplicate them in the Inbox topbar row. */
    .topbar.topbar--wa-inbox .topbar-actions { display: none; }
    .resort-pulse-bar--wa-inbox { display: none; }
    .main.main--wa-inbox {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    body.wa-inbox-mobile-thread .mobile-bar { display: none !important; }
    body.wa-inbox-mobile-thread .main { padding-bottom: 0; }
    /* Thread screen: drop the topbar entirely — the green thread header inside
       WhatsAppInbox.js already provides back-nav; nothing else needed here. */
    body.wa-inbox-mobile-thread .topbar { display: none !important; }
    /* Orit CS — detail view scrolls with the page; hide pulse for more room */
    body.orit-cs-mobile-detail .resort-pulse-bar { display: none !important; }
    .stat-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-sm);
      margin-bottom: var(--space-md);
    }
    .stat-card { padding: var(--space-md); }
    .stat-icon { font-size: 22px; }
    .stat-value { font-size: 26px; }
    .stat-label { font-size: 11px; }
    .stat-sub { font-size: 10px; }
    .form-grid { grid-template-columns: 1fr; }
    .kanban { grid-template-columns: 1fr; }
    .dash-grid { grid-template-columns: 1fr; gap: 14px; }
    .table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .layout { overflow-x: hidden; max-width: 100vw; }
    .app { overflow-x: hidden; max-width: 100vw; }
    .checkin-table-wrap { display: none !important; }
    .checkin-guest-cards {
      display: flex; flex-direction: column; gap: 12px;
      width: 100%; max-width: 100%;
    }
    .checkin-guest-card-actions .btn { flex: 1 1 100%; min-height: var(--hit-target-comfort); }

    /* Hamburger drawer — .sidebar.sidebar-mobile-open overrides the plain
       .sidebar display:none above via higher selector specificity (two
       classes vs one), regardless of source order. */
    .sidebar.sidebar-mobile-open {
      display: flex; width: 80vw; max-width: 300px; min-width: 0;
      box-shadow: -8px 0 30px rgba(0,0,0,0.35); z-index: 300;
    }
    .sidebar-mobile-backdrop.show {
      display: block; position: fixed; inset: 0;
      background: rgba(0,0,0,0.5); z-index: 290;
    }
    /* Touch targets — comfortable thumb tapping for nav/buttons/inputs. */
    .nav-item, .logout-btn {
      min-height: var(--hit-target-staff);
      padding: 12px 14px; font-size: 15px;
    }
    .btn, button:not(.hamburger-btn):not(.mobile-nav-item) {
      min-height: var(--hit-target-comfort);
    }
    input, select, textarea {
      font-size: 15px; min-height: var(--hit-target-staff);
    }
    input[type="checkbox"] { width: 20px; height: 20px; }
  }

  /* Tablet — KPI 2×2 grid between phone and DeX desktop */
  @media (min-width: 769px) and (max-width: 1279px) {
    .stat-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-md);
    }
    .stat-value { font-size: 30px; }
    .dash-grid { gap: var(--space-md); }
  }

  @media (max-width: 390px) {
    .stat-grid { gap: var(--space-xs); }
    .stat-card { padding: var(--space-sm) var(--space-md); }
    .stat-value { font-size: 24px; }
    .stat-icon { font-size: 20px; }
  }

  /* ────────────────────────────────────────────────────────────────────────
     DeX "COMMAND CENTER" — Samsung Galaxy Tab S9 Ultra (landscape / DeX)
     Expansive, multi-column control dashboard for large tablet/desktop mode.
     ──────────────────────────────────────────────────────────────────────── */
  @media (min-width: 1280px) {
    .sidebar { width: 264px; }
    .main { margin-right: 264px; }
    .content { padding: 36px 48px; max-width: 1760px; margin: 0 auto; }
    .topbar { padding: 20px 48px; }
    .topbar-title { font-size: 24px; }
    .stat-grid { grid-template-columns: repeat(4, 1fr); gap: 22px; margin-bottom: 34px; }
    .stat-card { padding: 24px; }
    .stat-value { font-size: 34px; }
    .kanban { gap: 24px; }
    .card-title { font-size: 16px; }
  }

  /* Ultra-wide (DeX on external monitor): denser KPIs + 3-up sections */
  @media (min-width: 1760px) {
    .content { max-width: 2100px; }
    .stat-grid { grid-template-columns: repeat(4, 1fr); gap: 26px; }
    .dash-grid { grid-template-columns: 1.2fr 1fr; gap: 26px; }
  }
`;

// ============================================================
// COMPONENTS
// ============================================================

// Google Sign-In — whitelist lives in utils/admin.js (isGoogleAuthAllowed).

function googleAuthErrorMessage(err) {
  const m = (err?.message ?? "").toLowerCase();
  if (m.includes("provider") && m.includes("not enabled")) {
    return "ספק Google לא מופעל ב-Supabase — פנה למנהל.";
  }
  if (m.includes("audience") || m.includes("client_id") || m.includes("client id")) {
    return "הגדרות Google OAuth לא תואמות (Client ID) — פנה למנהל.";
  }
  return err?.message ? `שגיאת התחברות: ${err.message}` : "שגיאה בהתחברות עם Google";
}

function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [googleReady, setGoogleReady] = useState(false);
  const googleClientMissing = !process.env.REACT_APP_GOOGLE_CLIENT_ID;

  // אתחול כפתור Google Sign-In
  useEffect(() => {
    if (googleClientMissing) return undefined;
    let active = true;
    initGoogleSignIn(async (cred) => {
      if (!active) return;
      setError("");
      const profile = decodeJwt(cred.credential);
      const gEmail = (profile.email || "").toLowerCase();

      if (!isGoogleAuthAllowed(gEmail)) {
        setError("✕ חשבון גוגל זה אינו מורשה במערכת. נא לפנות למנהל לרישום מסודר.");
        return;
      }

      if (isSupabaseConfigured && supabase) {
        const { error: authErr } = await supabase.auth.signInWithIdToken({
          provider: "google",
          token: cred.credential,
        });
        if (authErr) {
          console.error("signInWithIdToken failed:", authErr.message);
          setError(googleAuthErrorMessage(authErr));
          return;
        }
        return; // onAuthStateChange handles setUser + profile load
      }

      // Offline/demo only — no Supabase session.
      const name = profile.name || gEmail || "מנהל";
      const initials = name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2);
      onLogin({ id: Date.now(), name, role: "admin", email: gEmail, avatar: initials });
    }).then(() => {
      if (active) setGoogleReady(true);
    }).catch(() => {
      if (active) setError("לא ניתן לטעון את כפתור Google — נסה רענון או כניסה בסיסמה.");
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleClientMissing]);

  const handleLogin = async () => {
    setError("");
    const raw = email.trim().toLowerCase().replace(/\s+/g, "");
    const pass = password;
    if (!raw || !pass) { setError("נא למלא שם משתמש וסיסמה"); return; }

    // ── 1. Supabase real auth (staff / receptionists with real accounts) ──
    if (isSupabaseConfigured && supabase) {
      const emailToTry = raw.includes("@") ? raw : `${raw}@dream.io`;
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: emailToTry,
        password: pass,
      });
      if (!authErr) return; // onAuthStateChange → loadUserWithProfile → setUser
      setError("שם משתמש או סיסמה שגויים");
      return;
    }

    setError("שם משתמש או סיסמה שגויים");
  };

  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-logo">
          <img
            src="/images/dream%20island.jpg"
            alt="Dream Island Spa & Health Resort"
            className="login-logo-img"
          />
          <div className="login-divider" />
        </div>

        {/* התחברות עם Google — לחשבונות מנהלים מורשים בלבד */}
        {googleClientMissing ? (
          <div className="login-error" style={{ marginBottom: 12 }}>
            ⚠ כפתור Google לא זמין (חסר REACT_APP_GOOGLE_CLIENT_ID בבילד) — השתמש באימייל וסיסמה.
          </div>
        ) : (
          <>
            <div className="gsi-wrap" id="gsi-button" />
            {!googleReady && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", marginBottom: 8 }}>
                טוען כפתור Google...
              </div>
            )}
          </>
        )}
        <div className="login-or">או כניסה עם אימייל וסיסמה</div>

        <div className="login-field">
          <label>אימייל / שם משתמש</label>
          <input
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="staff@dream.com"
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          />
        </div>
        <div className="login-field">
          <label>סיסמה</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          />
        </div>
        <button className="login-btn" onClick={handleLogin}>
          כניסה למערכת
        </button>
        {error && <div className="login-error">{error}</div>}
      </div>
    </div>
  );
}

// ── Smart onboarding modal — 3-step wizard for new users ────────────────────────
// Step 0: Department selection
// Step 1: Job title input
// Step 2: Role selection (manager / staff)
// Saves all fields to profiles atomically at the end.
function DepartmentOnboardingModal({ user, onComplete }) {
  const [step,       setStep]       = useState(0);
  const [dept,       setDept]       = useState("");
  const [jobTitle,   setJobTitle]   = useState("");
  const [roleChoice, setRoleChoice] = useState(""); // 'manager' | 'staff'
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState("");

  const firstName = (user.name || "").split(" ")[0] || "עמית";

  const handleSave = async () => {
    if (!dept || (!roleChoice && !isRestaurantDepartment(dept))) return;
    setSaving(true);
    setError("");
    const restaurantDept = isRestaurantDepartment(dept);
    const savedDept = restaurantDept ? RESTAURANT_DEPARTMENT : dept;
    const savedRole = restaurantDept ? "restaurant" : roleChoice;
    try {
      if (isSupabaseConfigured && supabase) {
        const profilePatch = {
          id:         user.id,
          name:       user.name,
          email:      user.email,
          department: savedDept,
          job_title:  jobTitle.trim() || null,
        };
        if (restaurantDept) {
          profilePatch.role = "restaurant";
          profilePatch.restaurant_access = true;
        }
        const { error: saveErr } = await supabase
          .from("profiles")
          .upsert(profilePatch);
        if (saveErr) throw saveErr;
      }
      onComplete({
        ...user,
        department: savedDept,
        job_title: jobTitle.trim(),
        role: savedRole,
        ...(restaurantDept ? { restaurant_access: true } : {}),
      });
    } catch (e) {
      console.error("[onboarding] save failed:", e);
      setError(e?.message || "שגיאה בשמירה — נסה שוב או פנה למנהל המערכת");
    }
    setSaving(false);
  };

  const cardStyle = {
    background: "var(--card-bg)", borderRadius: 20, padding: "36px 32px",
    width: "100%", maxWidth: 440, textAlign: "center",
    boxShadow: "0 32px 80px rgba(0,0,0,0.4)",
    border: "1px solid var(--border)",
  };

  const inputStyle = {
    width: "100%", padding: "14px 16px",
    border: "1.5px solid var(--border)", borderRadius: 10,
    fontFamily: "Heebo, sans-serif", fontSize: 15,
    background: "var(--card-bg)", outline: "none", marginBottom: 16,
    boxSizing: "border-box", direction: "rtl",
  };

  const btnPrimary = (disabled) => ({
    width: "100%", padding: "14px",
    background: disabled
      ? "var(--border)"
      : "linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%)",
    border: "none", borderRadius: 10,
    fontFamily: "Heebo, sans-serif", fontSize: 15, fontWeight: 800,
    color: disabled ? "var(--text-muted)" : "#0F0F0F",
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "all 0.2s",
  });

  // Progress dots
  const ProgressDots = () => (
    <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 24 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: i === step ? 24 : 8, height: 8, borderRadius: 4,
          background: i <= step ? "var(--gold)" : "var(--border)",
          transition: "all 0.3s",
        }} />
      ))}
    </div>
  );

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: "rgba(15,15,15,0.85)", backdropFilter: "blur(10px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>

      {/* ── Step 0: Department ── */}
      {step === 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>🏝️</div>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 700, color: "var(--black)", marginBottom: 6 }}>
            ברוך הבא, {firstName}!
          </div>
          <div style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 20 }}>
            כמה שאלות קצרות כדי שנגדיר אותך במערכת
          </div>
          <ProgressDots />
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--black)", marginBottom: 12, textAlign: "right" }}>
            לאיזו מחלקה אתה שייך?
          </div>
          <select
            value={dept}
            onChange={e => setDept(e.target.value)}
            style={{ ...inputStyle, color: dept ? "var(--text-main)" : "var(--text-muted)", cursor: "pointer" }}
          >
            <option value="">בחר מחלקה...</option>
            {ONBOARDING_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <button onClick={() => setStep(1)} disabled={!dept} style={btnPrimary(!dept)}>
            המשך ←
          </button>
        </div>
      )}

      {/* ── Step 1: Job title ── */}
      {step === 1 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>💼</div>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 700, color: "var(--black)", marginBottom: 6 }}>
            מה תפקידך?
          </div>
          <div style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 20 }}>
            מחלקה: <strong>{dept}</strong>
          </div>
          <ProgressDots />
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--black)", marginBottom: 12, textAlign: "right" }}>
            כותרת תפקיד
          </div>
          <input
            autoFocus
            type="text"
            value={jobTitle}
            onChange={e => setJobTitle(e.target.value)}
            placeholder="לדוגמה: מנהל משמרת, מלצר, קונסיירז'..."
            style={inputStyle}
          />
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setStep(0)} style={{
              flex: 1, padding: "14px", borderRadius: 10, border: "1.5px solid var(--border)",
              background: "var(--card-bg)", fontFamily: "Heebo, sans-serif", fontSize: 14,
              color: "var(--text-muted)", cursor: "pointer",
            }}>→ חזור</button>
            <button onClick={() => setStep(2)} style={{ ...btnPrimary(false), flex: 2 }}>
              המשך ←
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Role ── */}
      {step === 2 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>🔑</div>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 700, color: "var(--black)", marginBottom: 6 }}>
            מה רמת הגישה שלך?
          </div>
          <div style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 20 }}>
            {dept}{jobTitle ? ` · ${jobTitle}` : ""}
          </div>
          <ProgressDots />
          {isRestaurantDepartment(dept) ? (
            <div style={{ marginBottom: 20, textAlign: "right" }}>
              <div style={{
                width: "100%", padding: "16px", borderRadius: 12,
                border: "2px solid var(--gold)",
                background: "rgba(201,169,110,0.1)",
                fontFamily: "Heebo, sans-serif",
              }}>
                <div style={{ fontWeight: 800, fontSize: 15, color: "var(--black)", marginBottom: 4 }}>
                  🍽️ לוח מסעדה
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  תיאום שעות ארוחה, הודעות וואטסאפ לאורחים — גישה ללוח המסעדה בלבד
                </div>
              </div>
            </div>
          ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
            {[
              { value: "manager", icon: "🏢", title: "מנהל מחלקה", desc: "גישה מלאה לניהול, משמרות, עובדים ודוחות" },
              { value: "staff",   icon: "👤", title: "עובד",         desc: "גישה לדאשבורד, משמרות ועוזר AI אישי" },
            ].map(({ value, icon, title, desc }) => (
              <button
                key={value}
                onClick={() => setRoleChoice(value)}
                style={{
                  width: "100%", padding: "16px", borderRadius: 12, cursor: "pointer",
                  border: `2px solid ${roleChoice === value ? "var(--gold)" : "var(--border)"}`,
                  background: roleChoice === value ? "rgba(201,169,110,0.1)" : "var(--card-bg)",
                  textAlign: "right", fontFamily: "Heebo, sans-serif",
                  transition: "all 0.15s",
                }}
              >
                <div style={{ fontWeight: 800, fontSize: 15, color: "var(--black)", marginBottom: 4 }}>
                  {icon} {title}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{desc}</div>
              </button>
            ))}
          </div>
          )}
          {error && (
            <div style={{
              background: "#FFF0EE", border: "1px solid #C0392B", borderRadius: 8,
              padding: "10px 12px", marginBottom: 14, fontSize: 13, color: "#C0392B", textAlign: "right",
            }}>
              ⚠ {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setStep(1)} style={{
              flex: 1, padding: "14px", borderRadius: 10, border: "1.5px solid var(--border)",
              background: "var(--card-bg)", fontFamily: "Heebo, sans-serif", fontSize: 14,
              color: "var(--text-muted)", cursor: "pointer",
            }}>→ חזור</button>
            <button
              onClick={handleSave}
              disabled={(!roleChoice && !isRestaurantDepartment(dept)) || saving}
              style={{ ...btnPrimary((!roleChoice && !isRestaurantDepartment(dept)) || saving), flex: 2 }}
            >
              {saving ? "⏳ שומר..." : "✅ כניסה למערכת"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Sidebar({ user, active, setActive, openOpsCount, onLogout, isAdmin, isSuperAdminUser, mobileOpen, onCloseMobile }) {
  const allNavItems = [
    { id: "dashboard",  icon: "📊", label: "דאשבורד" },
    { id: "shifts",     icon: "🕐", label: "משמרות" },
    { id: "employees",  icon: "👥", label: "עובדים",                                 managerOnly: true },
    { id: "checklist",  icon: "✅", label: "צ'קליסטים",                              managerOnly: true },
    { id: "requests_board", icon: "📋", label: "לוח בקשות", managerOnly: true, receptionistOk: true },
    { id: "orit_cs_agent", icon: "👑", label: "סוכן שירות לקוחות", oritCsAgentOnly: true },
    { id: "ops_board",  icon: "🛠️", label: "תפעול ואחזקה", badge: openOpsCount,       managerOnly: false },
    { id: "vip_guests", icon: "🏨", label: "ניהול אורחים",                            managerOnly: true },
    { id: "broadcast",  icon: "📣", label: "שליחת הודעות",                           managerOnly: true },
    { id: "wa_inbox",   icon: "💬", label: "DREAM BOT — שיחות",                     managerOnly: true, receptionistOk: true },
    { id: "guests",     icon: "🛎️", label: "צ'ק-אין",                               managerOnly: true },
    { id: "room_board",   icon: "🏨", label: "לוח סוויטות",                            managerOnly: false },
    { id: "spa_board",  icon: "💆", label: "לוח ספא",                                 managerOnly: true, receptionistOk: true },
    { id: "restaurant_dinner_board", icon: "🍽️", label: "לוח מסעדה", restaurantBoardOnly: true, managerOnly: true, receptionistOk: true },
    { id: "housekeeping_tablet", icon: "🧹", label: "לוח ניקיון (טאבלט)",              managerOnly: false },
    { id: "feedback_dashboard", icon: "🌟", label: "משוב אורחים",                     managerOnly: true, receptionistOk: true },
    { id: "scheduler",   icon: "🪄", label: "מחולל משמרות",                           managerOnly: true },
    { id: "agent",      icon: "📦", label: "ניהול מלאי" },
    { id: "data_sync",  icon: "📥", label: "סנכרון נתונים",                          managerOnly: true, receptionistOk: true },
    { id: "voucher_reconciliation", icon: "🧾", label: "התאמת שוברים",               managerOnly: true, receptionistOk: true },
  ];

  const navItems = filterNavItemsForUser(
    allNavItems.filter((item) => canSeeNavItem(item, user)),
    user,
  );

  const roleLabel = isAdmin
    ? "👑 מנהל מערכת"
    : user.role === "manager"
    ? "🏢 מנהל מחלקה"
    : user.role === "receptionist"
    ? "🛎️ פקיד/ת קבלה"
    : user.role === "restaurant"
    ? "🍽️ מסעדה"
    : user.role === "cleaner"
    ? "🧹 חדרנות"
    : "👤 עובד";

  return (
    <>
      {/* Mobile drawer backdrop — only meaningful at <=768px, where .sidebar
          itself becomes the slide-in drawer (see .sidebar-mobile-open CSS). */}
      {mobileOpen && (
        <div className="sidebar-mobile-backdrop show" onClick={onCloseMobile} />
      )}
      <div className={`sidebar${mobileOpen ? " sidebar-mobile-open" : ""}`}>
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <img
            src="/images/dream%20island.jpg"
            alt="Dream Island Spa & Health Resort"
            className="sidebar-brand-img"
          />
        </div>
        <div className="sidebar-user">
          <div className="avatar">{user.avatar}</div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user.name}</div>
            <div className="sidebar-user-role" style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {roleLabel}
            </div>
          </div>
        </div>
      </div>

      <div className="sidebar-nav">
        <div className="nav-section">
          <div className="nav-section-title">ניהול</div>
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${active === item.id ? "active" : ""}`}
              onClick={() => setActive(item.id)}
            >
              <span className="icon">{item.icon}</span>
              <span>{item.label}</span>
              {item.badge > 0 && (
                <span className="nav-badge">{item.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* Admin-only section */}
        {isAdmin && (
          <div className="nav-section" style={{ marginTop: 16 }}>
            <div className="nav-section-title">👑 אדמין</div>
            <button
              className={`nav-item ${active === "admin" ? "active" : ""}`}
              onClick={() => setActive("admin")}
              style={{ color: active === "admin" ? "var(--gold)" : "rgba(201,169,110,0.6)" }}
            >
              <span className="icon">🔧</span>
              <span>ניהול מערכת</span>
            </button>
            <button
              className={`nav-item ${active === "admin_updates" ? "active" : ""}`}
              onClick={() => setActive("admin_updates")}
              style={{ color: active === "admin_updates" ? "var(--gold)" : "rgba(201,169,110,0.6)" }}
            >
              <span className="icon">📜</span>
              <span>עדכוני מערכת</span>
            </button>
            <button
              className={`nav-item ${active === "portal_settings" ? "active" : ""}`}
              onClick={() => setActive("portal_settings")}
              style={{ color: active === "portal_settings" ? "var(--gold)" : "rgba(201,169,110,0.6)" }}
            >
              <span className="icon">🎨</span>
              <span>הגדרות פורטל</span>
            </button>
            <button
              className={`nav-item ${active === "bot_config" ? "active" : ""}`}
              onClick={() => setActive("bot_config")}
              style={{ color: active === "bot_config" ? "var(--gold)" : "rgba(201,169,110,0.6)" }}
            >
              <span className="icon">🤖</span>
              <span>הגדרות בוט</span>
            </button>
            <button
              className={`nav-item ${active === "bot_settings" ? "active" : ""}`}
              onClick={() => setActive("bot_settings")}
              style={{ color: active === "bot_settings" ? "var(--gold)" : "rgba(201,169,110,0.6)" }}
            >
              <span className="icon">🧠</span>
              <span>מוח הבוט</span>
            </button>
            <button
              className={`nav-item ${active === "bot_scripts" ? "active" : ""}`}
              onClick={() => setActive("bot_scripts")}
              style={{ color: active === "bot_scripts" ? "var(--gold)" : "rgba(201,169,110,0.6)" }}
            >
              <span className="icon">📝</span>
              <span>סקריפטי הבוט</span>
            </button>
            <button
              className={`nav-item ${active === "automation_center" ? "active" : ""}`}
              onClick={() => setActive("automation_center")}
              style={{ color: active === "automation_center" ? "var(--gold)" : "rgba(201,169,110,0.6)" }}
            >
              <span className="icon">🎛️</span>
              <span>בקרת אוטומציה</span>
            </button>
            {isSuperAdminUser && (
              <button
                className={`nav-item ${active === "executive_playbook" ? "active" : ""}`}
                onClick={() => setActive("executive_playbook")}
                style={{ color: active === "executive_playbook" ? "var(--gold)" : "rgba(201,169,110,0.6)" }}
              >
                <span className="icon">🧬</span>
                <span>סוכנים חכמים</span>
              </button>
            )}
            <button
              className={`nav-item ${active === "routing_control_center" ? "active" : ""}`}
              onClick={() => setActive("routing_control_center")}
              style={{ color: active === "routing_control_center" ? "var(--gold)" : "rgba(201,169,110,0.6)" }}
            >
              <span className="icon">🔀</span>
              <span>מרכז ניתוב</span>
            </button>
            <button
              className={`nav-item ${active === "cms_security" ? "active" : ""}`}
              onClick={() => setActive("cms_security")}
              style={{ color: active === "cms_security" ? "var(--gold)" : "rgba(201,169,110,0.6)" }}
            >
              <span className="icon">🔐</span>
              <span>אבטחת CMS</span>
            </button>
            {/* User Management — owner (super-admin) only */}
            {isSuperAdminUser && (
              <button
                className={`nav-item ${active === "users_mgmt" ? "active" : ""}`}
                onClick={() => setActive("users_mgmt")}
                style={{ color: active === "users_mgmt" ? "var(--gold)" : "rgba(201,169,110,0.6)" }}
              >
                <span className="icon">👥</span>
                <span>ניהול משתמשים</span>
              </button>
            )}
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <button className="logout-btn" onClick={onLogout}>
          <span>🚪</span> התנתקות
        </button>
      </div>
      </div>
    </>
  );
}

// Legacy local checklist UI — dashboard KPI still reads checklist_items from localStorage.
// eslint-disable-next-line no-unused-vars
function ChecklistPage({ checklist, setChecklist }) {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    task: "",
    department: "קבלה",
    assignedTo: "",
  });

  const toggle = (id) => {
    const now = new Date();
    const t = `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes()
    ).padStart(2, "0")}`;
    setChecklist((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, done: !c.done, time: !c.done ? t : "" } : c
      )
    );
  };

  const addTask = () => {
    if (!form.task) return;
    setChecklist((prev) => [
      ...prev,
      { id: Date.now(), ...form, done: false, time: "" },
    ]);
    setShowModal(false);
    setForm({ task: "", department: "קבלה", assignedTo: "" });
  };

  const doneCount = checklist.filter((c) => c.done).length;
  const pct = checklist.length ? Math.round((doneCount / checklist.length) * 100) : 0;

  const byDept = DEPARTMENTS.reduce((acc, d) => {
    const items = checklist.filter((c) => c.department === d);
    if (items.length) acc[d] = items;
    return acc;
  }, {});

  const deptColors = {
    קבלה: "#3498db",
    ניקיון: "#2ecc71",
    מסעדה: "#e67e22",
    תחזוקה: "#e74c3c",
    ביטחון: "#9b59b6",
    ספא: "#1abc9c",
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <div>
          <div style={{ fontSize: 14, color: "#8a9ab0" }}>
            {doneCount} מתוך {checklist.length} משימות הושלמו ({pct}%)
          </div>
          <div style={{ marginTop: 8, width: 200 }}>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          ＋ משימה חדשה
        </button>
      </div>

      {Object.entries(byDept).map(([dept, items]) => {
        const doneInDept = items.filter((i) => i.done).length;
        return (
          <div key={dept} className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: deptColors[dept] || "#8a9ab0",
                  }}
                />
                <div className="card-title">{dept}</div>
                <span className="badge badge-gray">
                  {doneInDept}/{items.length}
                </span>
              </div>
              <div style={{ width: 80 }}>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${Math.round(
                        (doneInDept / items.length) * 100
                      )}%`,
                      background: deptColors[dept],
                    }}
                  />
                </div>
              </div>
            </div>
            <div className="card-body">
              {items.map((item) => (
                <div key={item.id} className="checklist-item">
                  <div
                    className={`check-box ${item.done ? "checked" : ""}`}
                    onClick={() => toggle(item.id)}
                  >
                    {item.done && (
                      <span style={{ color: "#fff", fontSize: 13 }}>✓</span>
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className={`check-text ${item.done ? "done" : ""}`}>
                      {item.task}
                    </div>
                    <div className="check-dept">
                      👤 {item.assignedTo}
                      {item.done && item.time
                        ? ` · הושלם בשעה ${item.time}`
                        : ""}
                    </div>
                  </div>
                  {item.done && (
                    <span className="badge badge-green">✓ הושלם</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">✅ הוספת משימה לצ'קליסט</div>
            <div className="form-field">
              <label>שם המשימה</label>
              <input
                placeholder="לדוגמה: בדיקת מלאי מגבות"
                value={form.task}
                onChange={(e) =>
                  setForm((f) => ({ ...f, task: e.target.value }))
                }
              />
            </div>
            <div className="form-grid">
              <div className="form-field">
                <label>מחלקה</label>
                <select
                  value={form.department}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, department: e.target.value }))
                  }
                >
                  {DEPARTMENTS.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label>אחראי</label>
                <input
                  placeholder="שם העובד האחראי"
                  value={form.assignedTo}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, assignedTo: e.target.value }))
                  }
                />
              </div>
            </div>
            <div
              style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}
            >
              <button
                className="btn btn-ghost"
                onClick={() => setShowModal(false)}
              >
                ביטול
              </button>
              <button className="btn btn-primary" onClick={addTask}>
                הוסף משימה
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ============================================================
// SUPABASE AUTH HELPERS
// ============================================================

/** Map a raw Supabase session → minimal user object (role resolved from DB) */
function mapSupabaseUser(session) {
  if (!session?.user) return null;
  const u = session.user;
  return {
    id: u.id,
    email: u.email,
    name: u.user_metadata?.name || u.email?.split("@")[0] || "User",
    avatar: u.user_metadata?.avatar_url || null,
    avatar_text: (u.user_metadata?.name || u.email || "U")
      .slice(0, 2)
      .toUpperCase(),
    role: "staff",   // overwritten below after DB lookup
    source: "supabase",
  };
}

/** Fetch the profile row from DB and merge with the base user object */
async function loadUserWithProfile(session, setUser) {
  const base = mapSupabaseUser(session);
  if (!base) return;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("role, name, department, status, avatar, avatar_text, must_change_password, orit_cs_agent_access, restaurant_access")
      .eq("id", base.id)
      .maybeSingle();
    if (error) console.warn("[auth] profiles load:", error.message);
    setUser({ ...base, ...(data ?? {}), _profileLoaded: true });
  } catch (e) {
    console.warn("[auth] profiles load:", e?.message ?? e);
    setUser({ ...base, _profileLoaded: true });
  }
}

/** Defer Supabase DB calls out of onAuthStateChange — avoids auth lock deadlock. */
function scheduleLoadUserWithProfile(session, setUser) {
  if (!session) return;
  setTimeout(() => {
    loadUserWithProfile(session, setUser);
  }, 0);
}

// ============================================================
// SUPABASE PERSISTENCE HOOK
// ============================================================
//
// Drop-in replacement for useState that:
//   1. Fetches the table on mount (with a loading flag).
//   2. Seeds the table with mock data on first run (empty table).
//   3. On every local change, async-upserts the added/changed rows
//      so operational data survives a refresh (F5).
//
// Keeps the exact [data, setData] contract the page components expect,
// so ChecklistPage / EmployeesPage are unchanged.
// In demo/offline mode (no Supabase) it behaves like plain useState.

function usePersistentState(table, initialMock) {
  const [data, setDataRaw] = useState(initialMock);
  const [loading, setLoading] = useState(Boolean(isSupabaseConfigured));
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
      try {
        const { data: rows, error } = await supabase.from(table).select("*");
        if (!active) return;
        if (error) {
          console.error(`[persist] load ${table}:`, error.message);
        } else if (Array.isArray(rows)) {
          // Use whatever is in the DB — including an empty array, so a clean
          // database stays clean. Demo data is added manually via the
          // "Seed demo data" control in the Admin panel.
          setDataRaw(rows);
        }
      } catch (e) {
        console.error(`[persist] ${table}:`, e?.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, tick]);

  const setData = useCallback((updater) => {
    setDataRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (isSupabaseConfigured && supabase) {
        // Upsert only rows that were added or changed.
        const prevById = new Map(prev.map((r) => [r.id, r]));
        const changed = next.filter((r) => {
          const old = prevById.get(r.id);
          return !old || JSON.stringify(old) !== JSON.stringify(r);
        });
        if (changed.length > 0) {
          supabase.from(table).upsert(changed).then(({ error }) => {
            if (error) console.error(`[persist] upsert ${table}:`, error.message);
          });
        }
        // Propagate deletions (rows removed locally).
        const nextIds = new Set(next.map((r) => r.id));
        const removed = prev.filter((r) => !nextIds.has(r.id)).map((r) => r.id);
        if (removed.length > 0) {
          supabase.from(table).delete().in("id", removed).then(({ error }) => {
            if (error) console.error(`[persist] delete ${table}:`, error.message);
          });
        }
      }
      return next;
    });
  }, [table]);

  return [data, setData, loading, refetch];
}

// ============================================================
// MAIN APP
// ============================================================
export default function App({ initialPage = "dashboard" }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true); // true until auth resolves
  const [activePage, setActivePage] = useState(initialPage);
  // Hamburger drawer (mobile only, <=768px) — the desktop .sidebar is fully
  // hidden at that width with no replacement way to reach admin-only pages
  // (bot_scripts/automation_center/etc. aren't in the 5-item mobileNav bottom
  // bar). Reuses the same <Sidebar> component as a slide-in overlay instead
  // of duplicating nav logic.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Deep-link from Requests Board (etc.) → open a specific WA thread in DREAM BOT.
  const [inboxFocus, setInboxFocus] = useState(null); // { phone, guestName?, inboxChannel? } | null
  const [inboxReturn, setInboxReturn] = useState(null); // { page, guestId?, label? } — back from Inbox thread
  const [restaurantReturnGuestId, setRestaurantReturnGuestId] = useState(null);
  const [oritFocus, setOritFocus] = useState(null); // { threadId } | null
  const [inboxRosterFocus, setInboxRosterFocus] = useState(null); // roster filter chip id | null
  const [checkinFocus, setCheckinFocus] = useState(null); // { timelineScope, customArrivalDate? } | null
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const openDreamBotChat = useCallback(({ phone, guestName, inboxChannel, returnPage, returnGuestId, returnPageLabel } = {}) => {
    if (phone) {
      setInboxFocus({
        phone,
        guestName: guestName ?? null,
        inboxChannel: inboxChannel ?? null,
      });
      if (returnPage) {
        setInboxReturn({
          page: returnPage,
          guestId: returnGuestId ?? null,
          label: returnPageLabel ?? null,
        });
      } else {
        setInboxReturn(null);
      }
    }
    setActivePage("wa_inbox");
    setMobileMenuOpen(false);
  }, []);

  const returnFromInbox = useCallback(() => {
    const ret = inboxReturn;
    setInboxReturn(null);
    setInboxFocus(null);
    if (ret?.page) {
      if (ret.page === "restaurant_dinner_board" && ret.guestId) {
        setRestaurantReturnGuestId(ret.guestId);
      }
      setActivePage(ret.page);
      setMobileMenuOpen(false);
    }
  }, [inboxReturn]);
  const openCheckinTab = useCallback(({ timelineScope = "today", customArrivalDate = null } = {}) => {
    saveCheckinFilter({ scope: timelineScope, customDate: customArrivalDate });
    setCheckinFocus({ timelineScope, customArrivalDate });
    setActivePage("guests");
    setMobileMenuOpen(false);
  }, []);

  const handlePulseAction = useCallback((action) => {
    switch (action) {
      case "arrivals_today":
      case "departing_today":
        openCheckinTab({ timelineScope: "today" });
        break;
      case "in_resort":
        setInboxRosterFocus("in_resort");
        setActivePage("wa_inbox");
        setMobileMenuOpen(false);
        break;
      case "attention":
        setInboxRosterFocus("alerts");
        setActivePage("wa_inbox");
        setMobileMenuOpen(false);
        break;
      case "automation":
        if (canAccessRoute("automation_center", user)) {
          setActivePage("automation_center");
          setMobileMenuOpen(false);
        }
        break;
      default:
        break;
    }
  }, [openCheckinTab, user]);

  useEffect(() => {
    if (!user) return;
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [user]);
  const [employees, setEmployees, empLoading, refetchEmployees] = usePersistentState("employees", initialEmployees);
  const [shifts, setShifts, shiftLoading]       = usePersistentState("shifts", initialShifts);
  const [checklist, setChecklist, checkLoading] = usePersistentState("checklist_items", initialChecklists);
  const [openOpsCount, setOpenOpsCount] = useState(0);
  const opsLoading = empLoading || shiftLoading || checkLoading;
  // agentProfile value itself is no longer read anywhere (the "agent" route now
  // renders InventoryHub) — kept write-only since the background load effect
  // below + the still-present (now unreachable) settings modal still call the
  // setter. AgentQuestionnaire.js/AgentChat.js + their DB tables are left
  // completely untouched, per the owner's explicit choice to orphan rather
  // than delete that feature.
  const [, setAgentProfile] = useState(null);
  // Controls the settings/questionnaire modal overlay (keeps chat mounted underneath)
  const [showQuestionnaire, setShowQuestionnaire] = useState(false);
  // Push notification state: 'unsupported'|'unsubscribed'|'subscribed'|'denied'|'loading'
  const [pushState, setPushState] = useState("loading");
  // Active tab inside the settings slide-up modal (0 = questionnaire, 1 = knowledge)
  const [settingsTab, setSettingsTab] = useState(0);
  const isAdmin      = isAdminUser(user);
  const isSuperAdminUser = isSuperAdmin(user);

  /** Redirect users without the required role back to dashboard.
   *  Checks the DB role first, then falls back to email-based detection so
   *  that admin emails (isAdmin / isSuperAdminUser) are never locked out even
   *  if the DB role hasn't been synced yet (e.g. first login race condition). */
  const guardPage = useCallback((routeId, component) => {
    if (!user) return null;
    if (canAccessRoute(routeId, user)) return component;
    setTimeout(() => setActivePage("dashboard"), 0);
    return null;
  }, [user]);

  // ── Demo-data controls (Admin panel) ────────────────────────────────────────
  // Reuse the persistent setters: setX(rows) upserts adds/changes, setX([])
  // deletes everything — so these sync the DB and the UI in one shot.
  const seedDemoData = useCallback(() => {
    setEmployees(initialEmployees);
    setShifts(initialShifts);
    setChecklist(initialChecklists);
  }, [setEmployees, setShifts, setChecklist]);

  const clearAllData = useCallback(() => {
    setEmployees([]);
    setShifts([]);
    setChecklist([]);
  }, [setEmployees, setShifts, setChecklist]);

  // ── Logout (shared by Sidebar + Topbar) ──────────────────────────────────────
  // Also disables Google auto-select so the next login shows the account chooser
  // (lets the user switch between Google accounts cleanly).
  const handleLogout = useCallback(async () => {
    try { window.google?.accounts?.id?.disableAutoSelect?.(); } catch {}
    if (isSupabaseConfigured && supabase) {
      try { await supabase.auth.signOut(); } catch {}
    }
    setUser(null);
    setActivePage("dashboard");
  }, []);

  // ── Supabase session persistence ────────────────────────────────────────────
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setIsLoading(false); // offline / demo mode
      return;
    }
    // Restore session that already exists (survives F5)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) scheduleLoadUserWithProfile(session, setUser);
      setIsLoading(false);
    });
    // Keep state in sync with future sign-in / sign-out events.
    // Never await Supabase calls directly inside this callback (deadlock risk).
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session) {
          scheduleLoadUserWithProfile(session, setUser);
        } else {
          setUser(null);
        }
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  // QR / URL deep link (?page=wa_inbox) — captured in index.js before login.
  useEffect(() => {
    if (!user || isLoading) return;
    const pending = consumeStaffDeepLink();
    if (!pending?.page) return;
    if (!canAccessRoute(pending.page, user)) return;
    if ((user.role === "restaurant" || isRestaurantFocusedUser(user))
      && !RESTAURANT_FOCUS_NAV_IDS.has(pending.page)) return;
    if (pending.phone) {
      setInboxFocus({
        phone: pending.phone,
        guestName: pending.guestName ?? null,
        inboxChannel: pending.inboxChannel ?? null,
      });
    }
    if (pending.threadId) {
      setOritFocus({ threadId: pending.threadId });
    }
    setActivePage(pending.page);
    setMobileMenuOpen(false);
  }, [user, isLoading]);

  // ── Push state: initialise when user logs in, clear on logout ───────────────
  useEffect(() => {
    if (!user) { setPushState("loading"); return; }
    getPushState().then(setPushState);

    // Listen for subscription-change events dispatched by index.js ↔ SW bridge
    const onSubChanged = async (e) => {
      if (!supabase || !user?.id) return;
      try { await syncSubscriptionToSupabase(supabase, user.id, e.detail); } catch {}
      setPushState("subscribed");
    };
    window.addEventListener("pushsubscriptionchanged", onSubChanged);
    return () => window.removeEventListener("pushsubscriptionchanged", onSubChanged);
  }, [user]);

  // Push toggle handler called by the bell button
  const handlePushToggle = async () => {
    if (!user?.id) return;
    setPushState("loading");
    try {
      if (pushState === "subscribed") {
        await unsubscribeFromPush(supabase, user.id);
        setPushState("unsubscribed");
      } else {
        await subscribeToPush(supabase, user.id);
        setPushState("subscribed");
      }
    } catch (err) {
      setPushState(err.message === "permission_denied" ? "denied" : await getPushState());
    }
  };

  // Load agent profile when user logs in / out.
  // Supabase first (so the agent syncs across devices), localStorage fallback.
  useEffect(() => {
    let active = true;
    if (!user) { setAgentProfile(null); return; }
    (async () => {
      try {
        const profile = await loadAgentProfile(user.id); // Supabase → localStorage
        if (active && profile) setAgentProfile(profile);
      } catch {
        try {
          const stored = localStorage.getItem(`agent_profile_${user.id}`);
          if (active && stored) setAgentProfile(JSON.parse(stored));
        } catch {}
      }
    })();
    return () => { active = false; };
  }, [user]);

  // Sidebar ops badge — live count from Supabase tasks (not localStorage).
  useEffect(() => {
    if (!user || !isSupabaseConfigured || !supabase) {
      setOpenOpsCount(0);
      return undefined;
    }
    const userDept = user?.department || "";
    const canCreate = canPerform("create_ops_task", user);

    const refreshOpenOpsCount = async () => {
      let query = supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .in("status", ["open", "in_progress"]);
      if (!canCreate && userDept) {
        query = query.eq("department", userDept);
      }
      const { count, error } = await query;
      if (!error) setOpenOpsCount(count ?? 0);
    };

    refreshOpenOpsCount();
    const ch = supabase
      .channel("app-open-ops-count")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        () => refreshOpenOpsCount(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  // Inclusion list — open + in_progress only (migration 149, HITL gate).

  const pageTitle = {
    dashboard:  "דאשבורד ראשי 📊",
    shifts:     "סידור משמרות 🕐",
    checklist:  "צ'קליסטים יומיים ✅",
    employees:  "ניהול עובדים 👥",
    vip_guests: "🏨 ניהול אורחים",
    broadcast:  "📣 מודול שידור — WhatsApp",
    wa_inbox:   "💬 DREAM BOT — תיבת שיחות",
    guests:     "🛎️ צ'ק-אין",
    scheduler:  "🪄 מחולל משמרות",
    ops_board:  "🛠️ תפעול ואחזקה",
    tasks:      "🛠️ תפעול ואחזקה",
    calls:      "🛠️ תפעול ואחזקה",
    room_board:    "🏨 לוח סוויטות",
    spa_board:     "💆 לוח ספא",
    restaurant_dinner_board: "🍽️ לוח מסעדה",
    housekeeping_tablet: "🧹 לוח ניקיון (טאבלט)",
    requests_board: "📋 לוח בקשות",
    orit_cs_agent: "👑 סוכן שירות לקוחות",
    feedback_dashboard: "🌟 משוב אורחים",
    bot_config:    "🤖 הגדרות Smart Concierge",
    bot_settings:  "🧠 מוח הבוט",
    bot_scripts:   "📝 עורך סקריפטי הבוט",
    automation_center: "🎛️ בקרת אוטומציה",
    executive_playbook: "🧬 סוכנים חכמים",
    routing_control_center: "🔀 מרכז ניתוב",
    data_sync:  "📥 סנכרון נתונים",
    portal_settings: "🎨 הגדרות פורטל",
    cms_security: "🔐 אבטחת CMS",
    agent:      "📦 ניהול מלאי",
    admin:      "👑 ניהול מערכת",
    admin_updates: "📜 עדכוני מערכת",
    users_mgmt: "👥 ניהול משתמשים",
  };

  const today = new Date();
  const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  const dateStr = `${days[today.getDay()]}, ${today.getDate()}/${
    today.getMonth() + 1
  }/${today.getFullYear()}`;

  // ── Auth loading spinner (prevents flash of login screen on F5) ────────────
  if (isLoading)
    return (
      <>
        <style>{css}</style>
        <style>{`@keyframes di-spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: "100vh", background: "#0a0a0a", flexDirection: "column", gap: 16,
          fontFamily: "Heebo, sans-serif",
        }}>
          <div style={{
            width: 48, height: 48,
            border: "4px solid #2a2a2a",
            borderTop: "4px solid #C9A96E",
            borderRadius: "50%",
            animation: "di-spin 0.8s linear infinite",
          }} />
          <div style={{ color: "#C9A96E", fontSize: 14 }}>טוען...</div>
        </div>
      </>
    );

  if (!user)
    return (
      <>
        <style>{css}</style>
        <LoginPage onLogin={setUser} />
      </>
    );

  if (user.must_change_password)
    return (
      <>
        <style>{css}</style>
        <PasswordChangeScreen
          user={user}
          onComplete={(updated) => setUser(updated)}
        />
      </>
    );

  if (user && isSupabaseConfigured && !user._profileLoaded)
    return (
      <>
        <style>{css}</style>
        <style>{`@keyframes di-spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: "100vh", background: "#0a0a0a", flexDirection: "column", gap: 16,
          fontFamily: "Heebo, sans-serif",
        }}>
          <div style={{
            width: 48, height: 48,
            border: "4px solid #2a2a2a",
            borderTop: "4px solid #C9A96E",
            borderRadius: "50%",
            animation: "di-spin 0.8s linear infinite",
          }} />
          <div style={{ color: "#C9A96E", fontSize: 14 }}>טוען פרופיל...</div>
        </div>
      </>
    );

  // ── Cleaner kiosk — full-screen Housekeeping Tablet View, no sidebar ───
  // Session 28: swapped from RoomBoard's 6-status kiosk mode to the
  // dedicated 3-button fat-finger tablet view (HousekeepingTabletView.js).
  // RoomBoard.js itself is untouched and still reachable by managers via
  // the "room_board" nav route for the fuller תפוס/תחזוקה state machine.
  if (user.role === "cleaner")
    return (
      <>
        <style>{css}</style>
        <style>{`@keyframes di-spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ background: "var(--ivory)", minHeight: "100vh" }}>
          <HousekeepingTabletView isKioskMode onLogout={handleLogout} />
        </div>
      </>
    );

  // Restaurant kiosk — לוח מסעדה + שיחות WA (role=restaurant או restaurant_access לעובד)
  if (user.role === "restaurant" || isRestaurantFocusedUser(user))
    return (
      <>
        <style>{css}</style>
        <RestaurantKioskShell user={user} onLogout={handleLogout} />
      </>
    );


  const renderPage = () => {
    // Mandatory loading state while operational data is fetched from Supabase.
    const dataPages = ["dashboard", "shifts", "checklist", "employees"];
    if (opsLoading && dataPages.includes(activePage)) {
      return (
        <div style={{ textAlign: "center", padding: 64, color: "var(--text-muted)" }}>
          <div style={{
            width: 40, height: 40, margin: "0 auto 16px",
            border: "4px solid var(--border)", borderTop: "4px solid var(--gold)",
            borderRadius: "50%", animation: "di-spin 0.8s linear infinite",
          }} />
          טוען נתונים...
        </div>
      );
    }
    switch (activePage) {
      case "dashboard":
        return (
          <OperationalDashboard
            user={user}
            shifts={shifts}
            checklist={checklist}
            employees={employees}
            onNavigate={setActivePage}
            onOpenDreamBotChat={openDreamBotChat}
            onAttentionClick={() => {
              setInboxRosterFocus("alerts");
              setActivePage("wa_inbox");
              setMobileMenuOpen(false);
            }}
            onArrivalsClick={() => openCheckinTab({ timelineScope: "today" })}
            onAutomationClick={() => {
              if (canAccessRoute("automation_center", user)) {
                setActivePage("automation_center");
              }
            }}
          />
        );
      case "shifts":
        return (
          <ShiftScheduleTab
            user={user}
            employees={employees}
            onNavigate={setActivePage}
          />
        );
      case "checklist":
        return <ReceptionChecklist user={user} />;
      case "employees":
        return (
          <EmployeesPage user={user} onNavigate={setActivePage} />
        );
      case "vip_guests":
        return (
          <GuestDashboard
            user={user}
            onOpenCheckin={openCheckinTab}
            onOpenDreamBotChat={openDreamBotChat}
          />
        );
      case "broadcast":
        return <BroadcastDashboard user={user} />;
      case "wa_inbox":
        return (
          <WhatsAppInbox
            user={user}
            focusPhone={inboxFocus?.phone ?? null}
            focusGuestName={inboxFocus?.guestName ?? null}
            focusInboxChannel={inboxFocus?.inboxChannel ?? null}
            onFocusConsumed={() => setInboxFocus(null)}
            returnPage={inboxReturn?.page ?? null}
            returnPageLabel={inboxReturn?.label ?? null}
            onReturnToSource={inboxReturn?.page ? returnFromInbox : null}
            initialRosterFilter={inboxRosterFocus}
            onRosterFilterConsumed={() => setInboxRosterFocus(null)}
          />
        );
      case "guests":
        return (
          <GuestsPage
            initialTimelineScope={checkinFocus?.timelineScope ?? null}
            initialCustomArrivalDate={checkinFocus?.customArrivalDate ?? null}
            onTimelineScopeConsumed={() => setCheckinFocus(null)}
            onOpenDreamBotChat={openDreamBotChat}
            onOpenCheckin={openCheckinTab}
          />
        );
      case "scheduler":
        return (
          <ShiftGenerator
            user={user}
            onApproved={() => { refetchEmployees(); setActivePage("shifts"); }}
          />
        );
      case "agent":
        return (
          <InventoryHub
            user={user}
            onOpenScheduler={() => setActivePage("scheduler")}
          />
        );
      case "admin":
        return guardPage(
          "admin",
          <AdminPanel
            user={user}
            canManageData={isSuperAdminUser}
            onSeedDemo={seedDemoData}
            onClearData={clearAllData}
          />
        );
      case "admin_updates":
        return guardPage(
          "admin_updates",
          <AdminChangelogDashboard />
        );
      case "spa_staging":
        return <SpaStagingPanel />;
      case "room_board":
        return <RoomBoard />;
      case "spa_board":
        return <SpaBoard onOpenDreamBotChat={openDreamBotChat} />;
      case "restaurant_dinner_board":
        return guardPage("restaurant_dinner_board", (
          <RestaurantDinnerBoard
            user={user}
            onOpenDreamBotChat={openDreamBotChat}
            initialSelectedGuestId={restaurantReturnGuestId}
            onReturnGuestConsumed={() => setRestaurantReturnGuestId(null)}
          />
        ));
      case "housekeeping_tablet":
        return <HousekeepingTabletView />;
      case "requests_board":
        return <RequestsBoard user={user} onOpenDreamBotChat={openDreamBotChat} />;
      case "orit_cs_agent":
        return guardPage("orit_cs_agent", (
          <OritCustomerServicePanel
            user={user}
            onOpenDreamBotChat={openDreamBotChat}
            focusThreadId={oritFocus?.threadId ?? null}
            onFocusConsumed={() => setOritFocus(null)}
          />
        ));
      case "feedback_dashboard":
        return <GuestFeedbackTabs user={user} />;
      case "suites":
        return <SuitesDashboard />;
      // "tasks"/"calls" kept as deep-link aliases (same pattern as session
      // 12's nav decluttering) — both old screens are merged into one board.
      case "ops_board":
      case "tasks":
      case "calls":
        return <OperationsBoard user={user} isAdmin={isAdmin} onOpenDreamBotChat={openDreamBotChat} />;
      case "bot_config":
        return guardPage(
          "bot_config",
          <BotConfigPanel user={user} onNavigate={setActivePage} />
        );
      case "bot_settings":
        return guardPage(
          "bot_settings",
          <BotSettings />
        );
      case "bot_scripts":
        return guardPage(
          "bot_scripts",
          <BotScriptEditor />
        );
      case "executive_playbook":
        return guardPage(
          "executive_playbook",
          <ExecutivePlaybook onNavigateAppPage={setActivePage} />
        );
      case "automation_center":
        return guardPage(
          "automation_center",
          <AutomationControlCenter onOpenDreamBotChat={openDreamBotChat} />
        );
      case "data_sync":
        return guardPage(
          "data_sync",
          <DataSyncPage />
        );
      case "portal_settings":
        return guardPage(
          "portal_settings",
          <PortalSettingsPanel />
        );
      case "cms_security":
        return guardPage(
          "cms_security",
          <CMSGate><CMSSecurityPanel /></CMSGate>
        );
      case "voucher_reconciliation":
        return guardPage(
          "voucher_reconciliation",
          <VoucherReconciliationHub user={user} />
        );
      case "routing_control_center":
        return guardPage(
          "routing_control_center",
          <RoutingControlCenter />
        );
      case "users_mgmt":
        return guardPage(
          "users_mgmt",
          <UserManagement currentUser={user} />
        );
      default:
        return null;
    }
  };

  const mobileNav = [
    { id: "dashboard",  icon: "📊", label: "ראשי" },
    { id: "shifts",     icon: "🕐", label: "משמרות" },
    { id: "ops_board",  icon: "🛠️", label: "תפעול" },
    { id: "vip_guests", icon: "🏨", label: "סוויטות" },
    { id: "agent",      icon: "📦", label: "מלאי" },
  ];

  return (
    <>
      <style>{css}</style>
      <div className="app">
        <div className="layout">
          <Sidebar
            user={user}
            active={activePage}
            setActive={(id) => { setActivePage(id); setMobileMenuOpen(false); }}
            openOpsCount={openOpsCount}
            onLogout={handleLogout}
            isAdmin={isAdmin}
            isSuperAdminUser={isSuperAdminUser}
            mobileOpen={mobileMenuOpen}
            onCloseMobile={() => setMobileMenuOpen(false)}
          />
          <div className={`main${activePage === "wa_inbox" ? " main--wa-inbox" : ""}`}>
            <div className={`topbar${activePage === "wa_inbox" ? " topbar--wa-inbox" : ""}`}>
              <button
                className="hamburger-btn"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="פתח תפריט ניווט"
              >
                ☰
              </button>
              <div className="topbar-title">{pageTitle[activePage]}</div>
              <div className="topbar-actions" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button
                  type="button"
                  className="topbar-cmd-btn u-touch-staff"
                  onClick={() => setCmdPaletteOpen(true)}
                  title="חיפוש גלובלי (Ctrl+K)"
                >
                  🔍 <span className="cmd-kbd">Ctrl+K</span>
                </button>
                <div className="topbar-date">{dateStr}</div>

                {/* ── Push notification bell ────────────────────────── */}
                {pushState !== "unsupported" && (() => {
                  const bellMap = {
                    loading:      { icon: "🔔", label: "...",              color: "var(--text-muted)", disabled: true  },
                    unsubscribed: { icon: "🔔", label: "הפעל התראות",     color: "var(--gold-dark)",  disabled: false },
                    subscribed:   { icon: "🔔", label: "התראות פעילות",   color: "#1A7A4A",            disabled: false },
                    denied:       { icon: "🔕", label: "חסומות בדפדפן",   color: "#C0392B",            disabled: true  },
                    sw_missing:   { icon: "🔔", label: "הפעל התראות",     color: "var(--gold-dark)",  disabled: false },
                  };
                  const b = bellMap[pushState] || bellMap.loading;
                  return (
                    <button
                      onClick={handlePushToggle}
                      disabled={b.disabled}
                      title={b.label}
                      style={{
                        border: `1px solid ${pushState === "subscribed" ? "#1A7A4A33" : "var(--border)"}`,
                        background: pushState === "subscribed" ? "#E8F5EF" : "var(--card-bg)",
                        borderRadius: 8, padding: "5px 10px", cursor: b.disabled ? "default" : "pointer",
                        fontSize: 12, fontWeight: 700, color: b.color,
                        fontFamily: "Heebo, sans-serif", display: "flex", alignItems: "center", gap: 5,
                        opacity: b.disabled ? 0.6 : 1, transition: "all 0.2s", whiteSpace: "nowrap",
                      }}
                    >
                      <span style={{ fontSize: 16 }}>{b.icon}</span>
                      <span className="topbar-date" style={{ background: "none", border: "none", padding: 0, fontSize: 12, color: b.color }}>
                        {b.label}
                      </span>
                    </button>
                  );
                })()}

                {/* Account control — always visible (works on mobile too) */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  paddingInlineStart: 12, borderInlineStart: "1px solid var(--border)",
                }}>
                  <div
                    title={user.email}
                    style={{
                      width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
                      background: "linear-gradient(135deg, var(--gold), var(--gold-dark))",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, fontWeight: 800, color: "#0F0F0F", overflow: "hidden",
                    }}
                  >
                    {user.avatar && /^https?:\/\//.test(user.avatar)
                      ? <img src={user.avatar} alt={user.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : (user.avatar_text || user.avatar || (user.name || "?")[0])}
                  </div>
                  <div style={{ lineHeight: 1.2, maxWidth: 130, overflow: "hidden" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--black)", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
                      {user.name}
                    </div>
                    <div style={{ fontSize: 10, color: isSuperAdminUser ? "var(--gold-dark)" : "var(--text-muted)", fontWeight: 600 }}>
                      {isSuperAdminUser ? "👑 בעלים" : isAdmin ? "מנהל" : "צוות"}
                    </div>
                  </div>
                  <button
                    onClick={handleLogout}
                    title="התנתקות"
                    style={{
                      border: "1px solid var(--border)", background: "var(--card-bg)",
                      borderRadius: 8, padding: "6px 10px", cursor: "pointer",
                      fontSize: 13, fontWeight: 700, color: "#C0392B",
                      fontFamily: "Heebo, sans-serif", whiteSpace: "nowrap",
                    }}
                  >
                    🚪 יציאה
                  </button>
                </div>
              </div>
            </div>
            {user?.role !== "cleaner" && activePage !== "housekeeping_tablet" && (
              <ResortPulseBar
                onAction={handlePulseAction}
                className={activePage === "wa_inbox" ? "resort-pulse-bar--wa-inbox" : ""}
              />
            )}
            <div className={`content${activePage === "wa_inbox" ? " content--wa-inbox" : ""}`}>{renderPage()}</div>
          </div>
        </div>
        {/* Mobile nav */}
        <div className="mobile-bar">
          <div className="mobile-nav">
            {mobileNav.map((item) => (
              <button
                key={item.id}
                className={`mobile-nav-item ${
                  activePage === item.id ? "active" : ""
                }`}
                onClick={() => setActivePage(item.id)}
              >
                <span className="icon">{item.icon}</span>
                <span className="label">{item.label}</span>
                {item.id === "ops_board" && openOpsCount > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: 4,
                      background: "#ff4757",
                      color: "#fff",
                      borderRadius: "50%",
                      width: 14,
                      height: 14,
                      fontSize: 9,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                    }}
                  >
                    {openOpsCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

      {/* ── Department onboarding modal — blocks UI until new user selects dept ──
           Only shown to non-admin users who have no department set in DB.
           Role is NOT changed here; DB trigger + admin promote manages that. */}
      {/* AI Copilot — floating realtime widget for room-ready approval */}
      {user && <AICopilot user={user} />}

      {/* Requests Board alert — floating realtime widget for guest_alerts */}
      {user && <RequestsAlertWidget onNavigate={setActivePage} />}

      {/* AI engine failover alert — floating realtime banner for ai_failover_events */}
      {user && <AiFailoverWidget />}

      <GlobalCommandPalette
        open={cmdPaletteOpen}
        onClose={() => setCmdPaletteOpen(false)}
        onOpenInbox={openDreamBotChat}
        onOpenGuests={() => openCheckinTab({ timelineScope: "today" })}
        onOpenGuestManage={() => { setActivePage("vip_guests"); setMobileMenuOpen(false); }}
        onOpenAutomation={() => {
          if (canAccessRoute("automation_center", user)) setActivePage("automation_center");
        }}
      />

      {user && !user.department && !isAdmin && (
        <DepartmentOnboardingModal
          user={user}
          onComplete={(updated) => setUser(updated)}
        />
      )}

      {/* ── Settings / questionnaire modal — slides up over active chat ─────────
           AgentChat stays MOUNTED underneath so its message state is preserved. */}
      {showQuestionnaire && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setShowQuestionnaire(false); }}
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "flex-end", justifyContent: "center",
          }}
        >
          <div style={{
            width: "100%", maxWidth: 680,
            background: "var(--ivory)",
            borderRadius: "24px 24px 0 0",
            maxHeight: "90vh", overflowY: "auto",
            animation: "slideUp 0.3s ease-out",
          }}>
            {/* ── Sticky header ─────────────────────────────────────── */}
            <div style={{
              position: "sticky", top: 0, background: "var(--ivory)", zIndex: 1,
              borderBottom: "1px solid var(--border)",
            }}>
              {/* Title row */}
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "18px 24px 0",
              }}>
                <span style={{ fontWeight: 800, fontSize: 16, color: "var(--black)", fontFamily: "Playfair Display, serif" }}>
                  ⚙️ מרכז הגדרות הסוכן
                </span>
                <button
                  onClick={() => setShowQuestionnaire(false)}
                  className="btn btn-ghost btn-sm"
                >
                  ← חזור לצ׳אט
                </button>
              </div>
              {/* Tab bar */}
              <div style={{ display: "flex", gap: 0, padding: "10px 24px 0" }}>
                {[
                  { id: 0, label: "📋 פרופיל הסוכן" },
                  { id: 1, label: "🧠 למד את הסוכן" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setSettingsTab(tab.id)}
                    style={{
                      flex: 1, padding: "10px 8px", border: "none",
                      borderBottom: settingsTab === tab.id
                        ? "2px solid var(--gold)"
                        : "2px solid transparent",
                      background: "transparent", cursor: "pointer",
                      fontSize: 13, fontWeight: settingsTab === tab.id ? 700 : 500,
                      color: settingsTab === tab.id ? "var(--gold-dark)" : "var(--text-muted)",
                      fontFamily: "Heebo, sans-serif", transition: "all 0.15s",
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Modal body (tab-switched) ──────────────────────────── */}
            <div style={{ padding: "20px 24px 40px" }}>
              {settingsTab === 0 ? (
                <AgentQuestionnaire
                  user={user}
                  onComplete={(profile) => {
                    setAgentProfile(profile);
                    setShowQuestionnaire(false);
                  }}
                />
              ) : (
                <KnowledgeUploader user={user} />
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  );
}
