import { useState, useEffect, useCallback } from "react";
import { initGoogleSignIn } from "./googleAuth";
import AgentQuestionnaire from "./components/AgentQuestionnaire";
import AgentChat from "./components/AgentChat";
import AdminPanel from "./components/AdminPanel";
import UserManagement from "./components/UserManagement";
import DataUpload from "./components/DataUpload";
import GuestsPage from "./components/GuestsPage";
import ShiftGenerator from "./components/ShiftGenerator";
import EmployeesPage from "./components/EmployeesPage";
import { isAdminUser, isSuperAdmin, loadDepartments } from "./utils/admin";
import { supabase, isSupabaseConfigured, loadAgentProfile } from "./supabaseClient";
import { getPushState, subscribeToPush, unsubscribeFromPush, syncSubscriptionToSupabase } from "./utils/pushNotifications";
import KnowledgeUploader from "./components/KnowledgeUploader";
import GuestDashboard from "./components/GuestDashboard";
import BroadcastDashboard from "./components/BroadcastDashboard";
import WhatsAppInbox from "./components/WhatsAppInbox";
import TaskBoard from "./components/TaskBoard";
import BotConfigPanel from "./components/BotConfigPanel";
import BotSettings from "./components/BotSettings";
import BotScriptEditor from "./components/BotScriptEditor";
import RoomBoard from "./components/RoomBoard";
import PasswordChangeScreen from "./components/PasswordChangeScreen";
import SpaStagingPanel from "./components/SpaStagingPanel";

// ============================================================
// MOCK DATA - יוחלף ב-Supabase בגרסה האמיתית
// ============================================================
const MOCK_USERS = [
  {
    id: 1,
    name: "אליעד",
    role: "admin",
    email: "eliad",
    password: "1234",
    avatar: "אל",
  },
  {
    id: 2,
    name: "שירה לוי",
    role: "manager",
    email: "shira@dreamisland.com",
    password: "1234",
    avatar: "של",
    department: "קבלה",
  },
  {
    id: 3,
    name: "יוסי אברהם",
    role: "manager",
    email: "yossi@dreamisland.com",
    password: "1234",
    avatar: "יא",
    department: "מסעדה",
  },
];

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

const initialCalls = [
  {
    id: 1,
    title: "מזגן לא עובד בחדר 204",
    description: "אורח מתלונן על חום",
    priority: "גבוהה",
    assignedTo: "אלון שפירא",
    status: "פתוח",
    createdAt: "09:15",
    department: "תחזוקה",
  },
  {
    id: 2,
    title: "בקשת מגבות נוספות",
    description: "חדר 310 ביקש 4 מגבות",
    priority: "נמוכה",
    assignedTo: "רון כץ",
    status: "בטיפול",
    createdAt: "10:30",
    department: "ניקיון",
  },
  {
    id: 3,
    title: "בעיה בדלת חדר 118",
    description: "מנעול לא נסגר כראוי",
    priority: "דחופה",
    assignedTo: "אלון שפירא",
    status: "פתוח",
    createdAt: "11:00",
    department: "תחזוקה",
  },
  {
    id: 4,
    title: "אורח ביקש late checkout",
    description: "חדר 205 ביקש עד 14:00",
    priority: "בינונית",
    assignedTo: "דנה מזרחי",
    status: "טופל",
    createdAt: "08:45",
    department: "קבלה",
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
  @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800;900&family=Playfair+Display:wght@400;600;700&display=swap');

  @keyframes di-spin { to { transform: rotate(360deg); } }
  @keyframes slideUp {
    from { transform: translateY(100%); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }

  :root {
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
  .login-divider { width: 40px; height: 1px; background: var(--gold); margin: 12px auto 0; opacity: 0.4; }
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
  .sidebar-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
  .sidebar-brand-icon { font-size: 24px; }
  .sidebar-logo { color: var(--gold-light); font-size: 15px; font-weight: 700; font-family: 'Playfair Display', serif; }
  .sidebar-logo span { display: block; color: rgba(255,255,255,0.3); font-size: 10px; font-family: 'Heebo', sans-serif; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 1px; }
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
    margin-right: auto; background: #c0392b;
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
  .main { margin-right: 240px; flex: 1; min-height: 100vh; }
  .topbar {
    background: var(--card-bg); padding: 16px 28px;
    display: flex; align-items: center; justify-content: space-between;
    border-bottom: 1px solid var(--border);
    position: sticky; top: 0; z-index: 50;
    box-shadow: 0 2px 12px rgba(0,0,0,0.05);
  }
  .topbar-title { font-size: 19px; font-weight: 800; color: var(--black); font-family: 'Playfair Display', serif; }
  .topbar-date { font-size: 12px; color: var(--text-muted); background: var(--ivory); padding: 5px 12px; border-radius: 20px; border: 1px solid var(--border); }
  .content { padding: 28px; }

  /* CARDS */
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin-bottom: 28px; }
  .stat-card {
    background: var(--card-bg); border-radius: 14px;
    padding: 20px; box-shadow: 0 2px 12px rgba(0,0,0,0.05);
    border: 1px solid var(--border);
    position: relative; overflow: hidden;
  }
  .stat-card::after {
    content: ''; position: absolute; bottom: 0; right: 0;
    width: 60px; height: 60px;
    background: radial-gradient(circle, rgba(201,169,110,0.08) 0%, transparent 70%);
  }
  .stat-icon { font-size: 26px; margin-bottom: 10px; }
  .stat-value { font-size: 32px; font-weight: 900; color: var(--black); line-height: 1; }
  .stat-label { font-size: 12px; color: var(--text-muted); margin-top: 4px; font-weight: 500; }
  .stat-sub { font-size: 11px; margin-top: 6px; font-weight: 600; }

  .card {
    background: var(--card-bg); border-radius: 14px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.05);
    border: 1px solid var(--border); overflow: hidden;
    margin-bottom: 20px;
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
  .badge-green { background: #E8F5EF; color: #1A7A4A; }
  .badge-red { background: #FFF0EE; color: #C0392B; }
  .badge-orange { background: #FFF5E8; color: #B5600A; }
  .badge-blue { background: #EEF4FF; color: #2952A3; }
  .badge-gray { background: var(--ivory); color: var(--text-muted); border: 1px solid var(--border); }
  .badge-purple { background: #F3F0FF; color: #5B21B6; }
  .badge-gold { background: rgba(201,169,110,0.15); color: var(--gold-dark); border: 1px solid rgba(201,169,110,0.3); }

  /* PRIORITY */
  .dot-red { background: #C0392B; }
  .dot-orange { background: #B5600A; }
  .dot-green { background: #1A7A4A; }

  /* BUTTONS */
  .btn {
    padding: 10px 18px; border-radius: 8px;
    font-family: 'Heebo', sans-serif; font-size: 13px;
    font-weight: 700; cursor: pointer; border: none;
    transition: all 0.2s; display: inline-flex;
    align-items: center; gap: 6px;
  }
  .btn-primary {
    background: linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%);
    color: #0F0F0F; box-shadow: 0 2px 12px rgba(201,169,110,0.25);
  }
  .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(201,169,110,0.35); }
  .btn-ghost { background: transparent; color: var(--text-muted); border: 1px solid var(--border); }
  .btn-ghost:hover { background: var(--ivory); color: var(--black); }
  .btn-danger { background: #FFF0EE; color: #C0392B; }
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
    border-color: var(--gold); box-shadow: 0 0 0 3px rgba(201,169,110,0.1);
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
    padding: 8px 0 14px; z-index: 200;
    box-shadow: 0 -4px 20px rgba(0,0,0,0.2);
  }
  .mobile-nav { display: flex; justify-content: space-around; }
  .mobile-nav-item {
    display: flex; flex-direction: column; align-items: center;
    gap: 4px; cursor: pointer; padding: 4px 12px;
    border: none; background: none; font-family: 'Heebo', sans-serif;
    transition: all 0.2s; position: relative;
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

  /* DASHBOARD two-column section grid */
  .dash-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }

  @media (max-width: 768px) {
    .sidebar { display: none; }
    .main { margin-right: 0; padding-bottom: 80px; }
    .mobile-bar { display: block; }
    .topbar { padding: 14px 18px; }
    .topbar-date { display: none; } /* free up room for the account control */
    .content { padding: 16px; }
    .stat-grid { grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .form-grid { grid-template-columns: 1fr; }
    .kanban { grid-template-columns: 1fr; }
    .dash-grid { grid-template-columns: 1fr; gap: 14px; }
    .table-scroll { overflow-x: auto; }
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

function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  // אתחול כפתור Google Sign-In
  useEffect(() => {
    initGoogleSignIn(async (cred) => {
      // Preferred path: exchange the Google ID token for a REAL Supabase
      // session. This fires the handle_new_auth_user trigger (creates the
      // profile + assigns the role) and unlocks all RLS-protected writes.
      // App()'s onAuthStateChange then picks up the session and sets the user.
      if (isSupabaseConfigured && supabase) {
        const { error } = await supabase.auth.signInWithIdToken({
          provider: "google",
          token: cred.credential,
        });
        if (!error) return; // onAuthStateChange handles setUser + profile load
        console.error("signInWithIdToken failed → local fallback:", error.message);
      }

      // Fallback (offline/demo, or auth error): decode the token locally.
      // NOTE: default role is 'staff' — never auto-grant admin client-side.
      const profile = decodeJwt(cred.credential);
      const gEmail = (profile.email || "").toLowerCase();
      const matched = MOCK_USERS.find(
        (u) => (u.email || "").toLowerCase() === gEmail
      );
      if (matched) {
        onLogin(matched);
        return;
      }
      const name = profile.name || gEmail || "מנהל";
      const initials = name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2);
      onLogin({ id: Date.now(), name, role: "staff", email: gEmail, avatar: initials });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async () => {
    setError("");
    const raw = email.trim().toLowerCase().replace(/\s+/g, "");
    const pass = password;
    if (!raw || !pass) { setError("נא למלא שם משתמש וסיסמה"); return; }

    // ── 1. Supabase real auth ─────────────────────────────────────────────
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

    // ── 2. Fallback: MOCK_USERS (offline / demo) ──────────────────────────
    const user = MOCK_USERS.find(
      (u) => (u.email === raw || u.email === `${raw}@dream.io`) && u.password === pass
    );
    if (user) onLogin(user);
    else setError("שם משתמש או סיסמה שגויים");
  };

  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-logo">
          <div className="island">🏝️</div>
          <h1>Dream Island</h1>
          <p>RESORT MANAGEMENT SYSTEM</p>
          <div className="login-divider" />
        </div>

        {/* התחברות עם Google */}
        <div className="gsi-wrap" id="gsi-button" />
        <div className="login-or">או התחברות עם משתמש דמו</div>

        <div className="login-field">
          <label>שם משתמש</label>
          <input
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="david"
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
        <div
          style={{
            marginTop: 20,
            padding: 14,
            background: "rgba(255,255,255,0.06)",
            borderRadius: 10,
          }}
        >
          <div
            style={{
              color: "rgba(255,255,255,0.5)",
              fontSize: 11,
              marginBottom: 6,
            }}
          >
            משתמשי דמו:
          </div>
          {MOCK_USERS.map((u) => (
            <div
              key={u.id}
              style={{
                color: "rgba(255,255,255,0.35)",
                fontSize: 11,
                lineHeight: 1.8,
              }}
            >
              {u.email} / 1234 (
              {u.role === "admin" ? "מנהל כללי" : "מנהל מחלקה"})
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Hebrew department options (canonical list used across the whole app) ────────
const HOTEL_DEPARTMENTS = [
  "תפעול", "משק", "קבלה", "ספא", 'מזמ"ש (F&B)', "הנהלה",
];

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

  const firstName = (user.name || "").split(" ")[0] || "עמית";

  const handleSave = async () => {
    if (!dept || !roleChoice) return;
    setSaving(true);
    try {
      if (isSupabaseConfigured && supabase) {
        const { error } = await supabase
          .from("profiles")
          .update({
            department: dept,
            job_title:  jobTitle.trim() || null,
          })
          .eq("id", user.id);
        if (error) throw error;
      }
      onComplete({ ...user, department: dept, job_title: jobTitle.trim(), role: roleChoice });
    } catch (e) {
      console.error("[onboarding] save failed:", e);
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
            {HOTEL_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
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
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setStep(1)} style={{
              flex: 1, padding: "14px", borderRadius: 10, border: "1.5px solid var(--border)",
              background: "var(--card-bg)", fontFamily: "Heebo, sans-serif", fontSize: 14,
              color: "var(--text-muted)", cursor: "pointer",
            }}>→ חזור</button>
            <button
              onClick={handleSave}
              disabled={!roleChoice || saving}
              style={{ ...btnPrimary(!roleChoice || saving), flex: 2 }}
            >
              {saving ? "⏳ שומר..." : "✅ כניסה למערכת"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Sidebar({ user, active, setActive, openCallsCount, onLogout, isAdmin, isSuperAdminUser }) {
  // Managers, admins, and super-admins can see all nav items.
  // Staff (employees) see only: dashboard, shifts, and the AI agent.
  const isManagerOrAbove = isAdmin || isSuperAdminUser || user.role === "manager";

  const allNavItems = [
    { id: "dashboard",  icon: "📊", label: "דאשבורד" },
    { id: "shifts",     icon: "🕐", label: "משמרות" },
    { id: "calls",      icon: "🔔", label: "קריאות שירות", badge: openCallsCount, managerOnly: true },
    { id: "checklist",  icon: "✅", label: "צ'קליסטים",                              managerOnly: true },
    { id: "tasks",      icon: "📋", label: "לוח משימות",                             managerOnly: false },
    { id: "employees",  icon: "👥", label: "עובדים",                                 managerOnly: true },
    { id: "vip_guests", icon: "🏨", label: "אורחים סוויטות",                         managerOnly: true },
    { id: "broadcast",  icon: "📣", label: "שליחת הודעות",                           managerOnly: true },
    { id: "wa_inbox",   icon: "💬", label: "DREAM BOT — שיחות",                     managerOnly: true },
    { id: "guests",     icon: "🛎️", label: "אורחים",                                managerOnly: true },
    { id: "room_board",   icon: "🏨", label: "לוח חדרים",                              managerOnly: false },
    { id: "scheduler",   icon: "🪄", label: "מחולל משמרות",                           managerOnly: true },
    { id: "spa_staging", icon: "💆", label: "לוח ספא — אישור",                        managerOnly: true },
    // { id: "upload", icon: "📤", label: "העלאת נתונים", managerOnly: true }, // moved into GuestDashboard modal
    { id: "agent",      icon: "🤖", label: "הסוכן שלי" },
  ];

  const navItems = allNavItems.filter(item => !item.managerOnly || isManagerOrAbove);

  // User role label
  const roleLabel = isAdmin
    ? "👑 מנהל מערכת"
    : user.role === "manager"
    ? "🏢 מנהל מחלקה"
    : "👤 עובד";

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <span className="sidebar-brand-icon">🏝️</span>
          <div className="sidebar-logo">
            Dream Island <span>Resort Management</span>
          </div>
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
  );
}

function Dashboard({ shifts, calls, checklist, employees }) {
  const onShift = shifts.filter(
    (s) => s.status === "פעיל" && s.date === todayStr
  );
  const openCalls = calls.filter((c) => c.status === "פתוח");
  const urgentCalls = calls.filter(
    (c) => c.priority === "דחופה" && c.status !== "טופל"
  );
  const doneChecks = checklist.filter((c) => c.done).length;
  const checkPct = checklist.length ? Math.round((doneChecks / checklist.length) * 100) : 0;

  return (
    <div>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon">👨‍💼</div>
          <div className="stat-value">{onShift.length}</div>
          <div className="stat-label">במשמרת עכשיו</div>
          <div className="stat-sub" style={{ color: "#1A7A4A" }}>
            מתוך {employees.length} עובדים
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🔔</div>
          <div className="stat-value">{openCalls.length}</div>
          <div className="stat-label">קריאות פתוחות</div>
          {urgentCalls.length > 0 && (
            <div className="stat-sub" style={{ color: "#e53935" }}>
              {urgentCalls.length} דחופות!
            </div>
          )}
        </div>
        <div className="stat-card">
          <div className="stat-icon">✅</div>
          <div className="stat-value">{checkPct}%</div>
          <div className="stat-label">צ'קליסט הושלם</div>
          <div style={{ marginTop: 8 }}>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${checkPct}%` }}
              />
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🏢</div>
          <div className="stat-value">{DEPARTMENTS.length}</div>
          <div className="stat-label">מחלקות פעילות</div>
          <div className="stat-sub" style={{ color: "#1a6cc8" }}>
            כולן תקינות
          </div>
        </div>
      </div>

      {urgentCalls.length > 0 && (
        <div
          style={{
            background: "linear-gradient(135deg, #FFF5F3, #FFF)",
            border: "1px solid #FECACA",
            borderRadius: 12,
            padding: "14px 18px",
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 24 }}>🚨</span>
          <div>
            <div style={{ fontWeight: 700, color: "#e53935", fontSize: 14 }}>
              קריאות דחופות ממתינות לטיפול!
            </div>
            <div style={{ fontSize: 13, color: "#8a9ab0", marginTop: 2 }}>
              {urgentCalls.map((c) => c.title).join(" • ")}
            </div>
          </div>
        </div>
      )}

      <div className="dash-grid">
        <div className="card">
          <div className="card-header">
            <div className="card-title">🕐 עובדים במשמרת עכשיו</div>
          </div>
          <div className="card-body">
            {onShift.length === 0 ? (
              <div
                style={{
                  padding: 20,
                  color: "#8a9ab0",
                  textAlign: "center",
                  fontSize: 13,
                }}
              >
                אין משמרות פעילות כרגע
              </div>
            ) : (
              onShift.map((s) => (
                <div
                  key={s.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 20px",
                    borderBottom: "1px solid #f8fafc",
                  }}
                >
                  <div
                    className="avatar"
                    style={{ width: 32, height: 32, fontSize: 11 }}
                  >
                    {s.employeeName
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {s.employeeName}
                    </div>
                    <div style={{ fontSize: 11, color: "#8a9ab0" }}>
                      {s.department} · {s.start}–{s.end}
                    </div>
                  </div>
                  <span className="badge badge-green">פעיל</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">🔔 קריאות אחרונות</div>
          </div>
          <div className="card-body">
            {calls.slice(0, 4).map((c) => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 20px",
                  borderBottom: "1px solid #f8fafc",
                }}
              >
                <span
                  className={`priority-dot dot-${
                    c.priority === "דחופה"
                      ? "red"
                      : c.priority === "גבוהה"
                      ? "orange"
                      : "green"
                  }`}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    display: "block",
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.title}
                  </div>
                  <div style={{ fontSize: 11, color: "#8a9ab0" }}>
                    {c.assignedTo} · {c.createdAt}
                  </div>
                </div>
                <span
                  className={`badge ${
                    c.status === "טופל"
                      ? "badge-green"
                      : c.status === "בטיפול"
                      ? "badge-orange"
                      : "badge-red"
                  }`}
                >
                  {c.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ShiftsPage({ shifts, setShifts, employees }) {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    employeeId: "",
    date: todayStr,
    start: "08:00",
    end: "16:00",
    department: "",
  });

  const todayShifts = shifts.filter((s) => s.date === todayStr);

  const statusColor = {
    פעיל: "badge-green",
    עתידי: "badge-blue",
    הסתיים: "badge-gray",
  };
  const rowClass = {
    פעיל: "shift-active",
    עתידי: "shift-future",
    הסתיים: "shift-done",
  };

  const addShift = () => {
    const emp = employees.find((e) => e.id === parseInt(form.employeeId));
    if (!emp) return;
    const now = new Date();
    const [sh, sm] = form.start.split(":").map(Number);
    const [eh, em] = form.end.split(":").map(Number);
    const startMin = sh * 60 + sm,
      endMin = eh * 60 + em;
    const curMin = now.getHours() * 60 + now.getMinutes();
    const status =
      form.date > todayStr
        ? "עתידי"
        : curMin < startMin
        ? "עתידי"
        : curMin > endMin
        ? "הסתיים"
        : "פעיל";
    setShifts((prev) => [
      ...prev,
      {
        id: Date.now(),
        employeeId: emp.id,
        employeeName: emp.name,
        department: form.department || emp.department,
        date: form.date,
        start: form.start,
        end: form.end,
        status,
      },
    ]);
    setShowModal(false);
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
            משמרות להיום – {todayShifts.length} רשומות
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          ＋ הוסף משמרת
        </button>
      </div>

      <div className="card">
        <div className="card-body table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>עובד</th>
                <th>מחלקה</th>
                <th>תאריך</th>
                <th>שעת התחלה</th>
                <th>שעת סיום</th>
                <th>סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {shifts
                .slice()
                .sort((a, b) => (a.date > b.date ? -1 : 1))
                .map((s) => (
                  <tr key={s.id} className={rowClass[s.status] || ""}>
                    <td style={{ fontWeight: 600 }}>{s.employeeName}</td>
                    <td>
                      <span className="badge badge-blue">{s.department}</span>
                    </td>
                    <td>{s.date}</td>
                    <td>{s.start}</td>
                    <td>{s.end}</td>
                    <td>
                      <span className={`badge ${statusColor[s.status]}`}>
                        {s.status}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">➕ הוספת משמרת חדשה</div>
            <div className="form-field">
              <label>עובד</label>
              <select
                value={form.employeeId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, employeeId: e.target.value }))
                }
              >
                <option value="">בחר עובד...</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} – {e.department}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-grid">
              <div className="form-field">
                <label>תאריך</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, date: e.target.value }))
                  }
                />
              </div>
              <div className="form-field">
                <label>מחלקה</label>
                <select
                  value={form.department}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, department: e.target.value }))
                  }
                >
                  <option value="">ברירת מחלקה</option>
                  {DEPARTMENTS.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label>שעת התחלה</label>
                <input
                  type="time"
                  value={form.start}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, start: e.target.value }))
                  }
                />
              </div>
              <div className="form-field">
                <label>שעת סיום</label>
                <input
                  type="time"
                  value={form.end}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, end: e.target.value }))
                  }
                />
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                marginTop: 8,
              }}
            >
              <button
                className="btn btn-ghost"
                onClick={() => setShowModal(false)}
              >
                ביטול
              </button>
              <button className="btn btn-primary" onClick={addShift}>
                שמור משמרת
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CallsPage({ calls, setCalls, employees }) {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "בינונית",
    department: "קבלה",
    assignedTo: "",
  });

  const columns = [
    { id: "פתוח", label: "פתוח", color: "#e53935", bg: "#fff5f5" },
    { id: "בטיפול", label: "בטיפול", color: "#f5a623", bg: "#fffbf0" },
    { id: "טופל", label: "טופל", color: "#00a878", bg: "#f0fdf8" },
  ];

  const addCall = () => {
    if (!form.title) return;
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes()
    ).padStart(2, "0")}`;
    setCalls((prev) => [
      ...prev,
      { id: Date.now(), ...form, status: "פתוח", createdAt: timeStr },
    ]);
    setShowModal(false);
    setForm({
      title: "",
      description: "",
      priority: "בינונית",
      department: "קבלה",
      assignedTo: "",
    });
  };

  const updateStatus = (id, status) =>
    setCalls((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));

  const priorityBadge = {
    דחופה: "badge-red",
    גבוהה: "badge-orange",
    בינונית: "badge-blue",
    נמוכה: "badge-gray",
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
        <div style={{ fontSize: 14, color: "#8a9ab0" }}>
          {calls.filter((c) => c.status === "פתוח").length} קריאות פתוחות
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          ＋ קריאה חדשה
        </button>
      </div>

      <div className="kanban">
        {columns.map((col) => (
          <div
            key={col.id}
            className="kanban-col"
            style={{ background: col.bg }}
          >
            <div className="kanban-col-title" style={{ color: col.color }}>
              <span>
                {col.id === "פתוח" ? "🔴" : col.id === "בטיפול" ? "🟡" : "🟢"}
              </span>
              {col.label}
              <span
                style={{
                  background: col.color,
                  color: "#fff",
                  borderRadius: 10,
                  padding: "1px 8px",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {calls.filter((c) => c.status === col.id).length}
              </span>
            </div>
            {calls
              .filter((c) => c.status === col.id)
              .map((c) => (
                <div key={c.id} className="kanban-card">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: 6,
                    }}
                  >
                    <div className="kanban-card-title">{c.title}</div>
                    <span className={`badge ${priorityBadge[c.priority]}`}>
                      {c.priority}
                    </span>
                  </div>
                  {c.description && (
                    <div
                      style={{
                        fontSize: 12,
                        color: "#6a8a9a",
                        marginBottom: 8,
                        lineHeight: 1.4,
                      }}
                    >
                      {c.description}
                    </div>
                  )}
                  <div className="kanban-card-meta">
                    👤 {c.assignedTo || "לא הוקצה"} · 🏢 {c.department} · 🕐{" "}
                    {c.createdAt}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                    {col.id !== "פתוח" && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => updateStatus(c.id, "פתוח")}
                      >
                        פתח מחדש
                      </button>
                    )}
                    {col.id === "פתוח" && (
                      <button
                        className="btn btn-sm"
                        style={{ background: "#fff8e8", color: "#f5a623" }}
                        onClick={() => updateStatus(c.id, "בטיפול")}
                      >
                        התחל טיפול
                      </button>
                    )}
                    {col.id === "בטיפול" && (
                      <button
                        className="btn btn-sm"
                        style={{ background: "#e8faf4", color: "#00a878" }}
                        onClick={() => updateStatus(c.id, "טופל")}
                      >
                        סמן כטופל ✓
                      </button>
                    )}
                  </div>
                </div>
              ))}
          </div>
        ))}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">🔔 פתיחת קריאת שירות</div>
            <div className="form-field">
              <label>כותרת הקריאה</label>
              <input
                placeholder="לדוגמה: מזגן לא עובד בחדר 204"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
              />
            </div>
            <div className="form-field">
              <label>תיאור</label>
              <textarea
                rows={3}
                placeholder="פרטים נוספים..."
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </div>
            <div className="form-grid">
              <div className="form-field">
                <label>עדיפות</label>
                <select
                  value={form.priority}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, priority: e.target.value }))
                  }
                >
                  <option>דחופה</option>
                  <option>גבוהה</option>
                  <option>בינונית</option>
                  <option>נמוכה</option>
                </select>
              </div>
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
            </div>
            <div className="form-field">
              <label>הקצה לעובד</label>
              <select
                value={form.assignedTo}
                onChange={(e) =>
                  setForm((f) => ({ ...f, assignedTo: e.target.value }))
                }
              >
                <option value="">בחר עובד...</option>
                {employees.map((e) => (
                  <option key={e.id}>{e.name}</option>
                ))}
              </select>
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
              <button className="btn btn-primary" onClick={addCall}>
                פתח קריאה
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
    const { data } = await supabase
      .from("profiles")
      .select("role, name, department, status, avatar, avatar_text, must_change_password")
      .eq("id", base.id)
      .single();
    setUser({ ...base, ...(data ?? {}) });
  } catch {
    // No profile row yet — use base (trigger will create it shortly)
    setUser(base);
  }
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
// so ShiftsPage / CallsPage / ChecklistPage / EmployeesPage are unchanged.
// In demo/offline mode (no Supabase) it behaves like plain useState.

function usePersistentState(table, initialMock) {
  const [data, setDataRaw] = useState(initialMock);
  const [loading, setLoading] = useState(Boolean(isSupabaseConfigured));

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
  }, [table]);

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

  return [data, setData, loading];
}

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true); // true until auth resolves
  const [activePage, setActivePage] = useState("dashboard");
  const [employees, setEmployees, empLoading]   = usePersistentState("employees", initialEmployees);
  const [shifts, setShifts, shiftLoading]       = usePersistentState("shifts", initialShifts);
  const [calls, setCalls, callsLoading]         = usePersistentState("service_calls", initialCalls);
  const [checklist, setChecklist, checkLoading] = usePersistentState("checklist_items", initialChecklists);
  const opsLoading = empLoading || shiftLoading || callsLoading || checkLoading;
  const [agentProfile, setAgentProfile] = useState(null);
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
  const guardPage = useCallback((allowedRoles, component) => {
    if (!user) return null;
    if (allowedRoles.includes(user.role))                        return component;
    if (allowedRoles.includes("super_admin") && isSuperAdminUser) return component;
    if (allowedRoles.includes("admin")       && isAdmin)          return component;
    // Non-privileged user tried to access a restricted URL — bounce them out
    setTimeout(() => setActivePage("dashboard"), 0);
    return null;
  }, [user, isAdmin, isSuperAdminUser]);

  // ── Demo-data controls (Admin panel) ────────────────────────────────────────
  // Reuse the persistent setters: setX(rows) upserts adds/changes, setX([])
  // deletes everything — so these sync the DB and the UI in one shot.
  const seedDemoData = useCallback(() => {
    setEmployees(initialEmployees);
    setShifts(initialShifts);
    setCalls(initialCalls);
    setChecklist(initialChecklists);
  }, [setEmployees, setShifts, setCalls, setChecklist]);

  const clearAllData = useCallback(() => {
    setEmployees([]);
    setShifts([]);
    setCalls([]);
    setChecklist([]);
  }, [setEmployees, setShifts, setCalls, setChecklist]);

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
      if (session) loadUserWithProfile(session, setUser);
      setIsLoading(false);
    });
    // Keep state in sync with future sign-in / sign-out events
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session) {
          loadUserWithProfile(session, setUser);
        } else {
          setUser(null);
        }
      }
    );
    return () => subscription.unsubscribe();
  }, []);

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

  const openCallsCount = calls.filter((c) => c.status === "פתוח").length;

  const pageTitle = {
    dashboard:  "דאשבורד ראשי 📊",
    shifts:     "סידור משמרות 🕐",
    calls:      "קריאות שירות 🔔",
    checklist:  "צ'קליסטים יומיים ✅",
    employees:  "ניהול עובדים 👥",
    vip_guests: "🏨 אורחים סוויטות",
    broadcast:  "📣 מודול שידור — WhatsApp",
    wa_inbox:   "💬 DREAM BOT — תיבת שיחות",
    guests:     "🛎️ ניהול אורחים",
    scheduler:  "🪄 מחולל משמרות",
    upload:     "📤 העלאת נתונים",
    tasks:      "📋 לוח משימות",
    room_board:    "🏨 לוח חדרים",
    bot_config:    "🤖 הגדרות Smart Concierge",
    bot_settings:  "🧠 מוח הבוט",
    bot_scripts:   "📝 עורך סקריפטי הבוט",
    agent:      agentProfile ? `${agentProfile.display_name} 🤖` : "הסוכן שלי 🤖",
    admin:      "👑 ניהול מערכת",
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

  // ── Cleaner kiosk — full-screen RoomBoard, no sidebar ──────────────────
  if (user.role === "cleaner")
    return (
      <>
        <style>{css}</style>
        <style>{`@keyframes di-spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ background: "var(--ivory)", minHeight: "100vh" }}>
          <RoomBoard isKioskMode onLogout={handleLogout} />
        </div>
      </>
    );

  const renderPage = () => {
    // Mandatory loading state while operational data is fetched from Supabase.
    const dataPages = ["dashboard", "shifts", "calls", "checklist", "employees"];
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
          <Dashboard
            shifts={shifts}
            calls={calls}
            checklist={checklist}
            employees={employees}
          />
        );
      case "shifts":
        return (
          <ShiftsPage
            shifts={shifts}
            setShifts={setShifts}
            employees={employees}
          />
        );
      case "calls":
        return (
          <CallsPage calls={calls} setCalls={setCalls} employees={employees} />
        );
      case "checklist":
        return (
          <ChecklistPage checklist={checklist} setChecklist={setChecklist} />
        );
      case "employees":
        return (
          <EmployeesPage user={user} onNavigate={setActivePage} />
        );
      case "vip_guests":
        return <GuestDashboard user={user} />;
      case "broadcast":
        return <BroadcastDashboard user={user} />;
      case "wa_inbox":
        return <WhatsAppInbox />;
      case "guests":
        return <GuestsPage />;
      case "scheduler":
        return <ShiftGenerator user={user} onApproved={() => setActivePage("shifts")} />;
      case "upload":
        return (
          <DataUpload
            user={user}
            onImported={(mode) =>
              setActivePage(
                mode === "ezgo"   ? "vip_guests" :
                mode === "guests" ? "guests"     : "shifts"
              )
            }
          />
        );
      case "agent":
        if (!agentProfile) {
          return (
            <AgentQuestionnaire
              user={user}
              onComplete={(profile) => setAgentProfile(profile)}
            />
          );
        }
        return (
          <AgentChat
            user={user}
            agentProfile={agentProfile}
            onOpenSettings={() => setShowQuestionnaire(true)}
          />
        );
      case "admin":
        // admin + super_admin can access panel; staff/manager → redirected
        return guardPage(
          ["admin", "super_admin"],
          <AdminPanel
            user={user}
            mockUsers={MOCK_USERS}
            canManageData={isSuperAdminUser}
            onSeedDemo={seedDemoData}
            onClearData={clearAllData}
          />
        );
      case "spa_staging":
        return <SpaStagingPanel />;
      case "room_board":
        return <RoomBoard />;
      case "tasks":
        return <TaskBoard user={user} isAdmin={isAdmin} />;
      case "bot_config":
        return guardPage(
          ["admin", "super_admin"],
          <BotConfigPanel user={user} />
        );
      case "bot_settings":
        return guardPage(
          ["admin", "super_admin"],
          <BotSettings />
        );
      case "bot_scripts":
        return guardPage(
          ["admin", "super_admin"],
          <BotScriptEditor />
        );
      case "users_mgmt":
        // only super_admin manages users
        return guardPage(
          ["super_admin"],
          <UserManagement currentUser={user} />
        );
      default:
        return null;
    }
  };

  const mobileNav = [
    { id: "dashboard",  icon: "📊", label: "ראשי" },
    { id: "shifts",     icon: "🕐", label: "משמרות" },
    { id: "tasks",      icon: "📋", label: "משימות" },
    { id: "vip_guests", icon: "🏨", label: "סוויטות" },
    { id: "agent",      icon: "🤖", label: "סוכן" },
  ];

  return (
    <>
      <style>{css}</style>
      <div className="app">
        <div className="layout">
          <Sidebar
            user={user}
            active={activePage}
            setActive={setActivePage}
            openCallsCount={openCallsCount}
            onLogout={handleLogout}
            isAdmin={isAdmin}
            isSuperAdminUser={isSuperAdminUser}
          />
          <div className="main">
            <div className="topbar">
              <div className="topbar-title">{pageTitle[activePage]}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
            <div className="content">{renderPage()}</div>
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
                {item.id === "calls" && openCallsCount > 0 && (
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
                    {openCallsCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

      {/* ── Department onboarding modal — blocks UI until new user selects dept ──
           Only shown to non-admin users who have no department set in DB.
           Role is NOT changed here; DB trigger + admin promote manages that. */}
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
