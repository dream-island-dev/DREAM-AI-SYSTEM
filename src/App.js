import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import { initGoogleSignIn } from "./googleAuth";
import AgentQuestionnaire from "./components/AgentQuestionnaire";
import AgentChat from "./components/AgentChat";
import WhatsAppBroadcast from "./components/WhatsAppBroadcast";
import MarketingHub from "./components/MarketingHub";
import BookingsManager from "./components/BookingsManager";
import RoomStatusBoard from "./components/RoomStatusBoard";
import CleaningQR from "./components/CleaningQR";
import BroadcastDashboard from "./components/BroadcastDashboard";

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

const DEPARTMENTS = ["קבלה", "ניקיון", "מסעדה", "תחזוקה", "ביטחון", "ספא"];

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

  @media (max-width: 768px) {
    .sidebar { display: none; }
    .main { margin-right: 0; padding-bottom: 80px; }
    .mobile-bar { display: block; }
    .topbar { padding: 14px 18px; }
    .content { padding: 16px; }
    .stat-grid { grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .form-grid { grid-template-columns: 1fr; }
    .kanban { grid-template-columns: 1fr; }
    .table-scroll { overflow-x: auto; }
  }
`;

// ============================================================
// COMPONENTS
// ============================================================

function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // אתחול כפתור Google Sign-In
  useEffect(() => {
    initGoogleSignIn((cred) => {
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
      onLogin({ id: Date.now(), name, role: "admin", email: gEmail, avatar: initials });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async () => {
    setError("");
    setLoading(true);
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (authError) {
      setError("אימייל או סיסמה שגויים");
      return;
    }
    const u = data.user;
    const meta = u.user_metadata || {};
    const name = meta.name || u.email;
    const initials = name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
    onLogin({
      id: u.id,
      name,
      role: meta.role || "manager",
      email: u.email,
      avatar: meta.avatar || initials,
      department: meta.department || "",
    });
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
        <div className="login-or">או</div>

        <div className="login-field">
          <label>אימייל</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
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
        <button className="login-btn" onClick={handleLogin} disabled={loading}>
          {loading ? "מתחבר..." : "כניסה למערכת"}
        </button>
        {error && <div className="login-error">{error}</div>}
      </div>
    </div>
  );
}

function Sidebar({ user, active, setActive, openCallsCount, onLogout }) {
  const isManager = user.role === "admin" || user.role === "manager";

  const navItems = [
    { id: "dashboard",  icon: "📊", label: "דאשבורד" },
    { id: "shifts",     icon: "🕐", label: "משמרות" },
    { id: "calls",      icon: "🔔", label: "קריאות שירות", badge: openCallsCount },
    { id: "checklist",  icon: "✅", label: "צ'קליסטים" },
    { id: "employees",  icon: "👥", label: "עובדים" },
    { id: "marketing",  icon: "🎯", label: "שיווק ושימור",  managerOnly: true },
    { id: "broadcast",      icon: "📨", label: "WhatsApp Broadcast" },
    { id: "broadcast_dash", icon: "📊", label: "Broadcast Dashboard" },
    { id: "rooms",      icon: "🏨", label: "סטטוס חדרים" },
    { id: "cleaning",   icon: "🧹", label: "QR ניקיון" },
    { id: "bookings",   icon: "💳", label: "הזמנות ותשלומים" },
    { id: "agent",      icon: "🤖", label: "הסוכן שלי" },
  ].filter((item) => !item.managerOnly || isManager);

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
            <div className="sidebar-user-role">
              {user.role === "admin" ? "מנהל כללי" : "מנהל מחלקה"}
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
  const checkPct = Math.round((doneChecks / checklist.length) * 100);

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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
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
  const pct = Math.round((doneCount / checklist.length) * 100);

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

function EmployeesPage({ employees, setEmployees }) {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    name: "",
    department: "קבלה",
    role: "",
    phone: "",
    status: "פעיל",
  });

  const addEmployee = () => {
    if (!form.name) return;
    setEmployees((prev) => [...prev, { id: Date.now(), ...form }]);
    setShowModal(false);
    setForm({
      name: "",
      department: "קבלה",
      role: "",
      phone: "",
      status: "פעיל",
    });
  };

  const deptColors = {
    קבלה: "badge-blue",
    ניקיון: "badge-green",
    מסעדה: "badge-orange",
    תחזוקה: "badge-red",
    ביטחון: "badge-purple",
    ספא: "badge-green",
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
          {employees.length} עובדים פעילים
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          ＋ עובד חדש
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        {employees.map((emp) => (
          <div key={emp.id} className="card" style={{ margin: 0 }}>
            <div style={{ padding: 20 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  marginBottom: 14,
                }}
              >
                <div
                  className="avatar"
                  style={{ width: 44, height: 44, fontSize: 15 }}
                >
                  {emp.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)}
                </div>
                <div>
                  <div
                    style={{ fontWeight: 700, fontSize: 15, color: "#0f2027" }}
                  >
                    {emp.name}
                  </div>
                  <div style={{ fontSize: 12, color: "#8a9ab0" }}>
                    {emp.role}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span
                  className={`badge ${
                    deptColors[emp.department] || "badge-gray"
                  }`}
                >
                  {emp.department}
                </span>
                <span
                  className={`badge ${
                    emp.status === "פעיל" ? "badge-green" : "badge-gray"
                  }`}
                >
                  {emp.status}
                </span>
              </div>
              {emp.phone && (
                <div style={{ fontSize: 12, color: "#8a9ab0", marginTop: 10 }}>
                  📞 {emp.phone}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">👤 הוספת עובד חדש</div>
            <div className="form-field">
              <label>שם מלא</label>
              <input
                placeholder="שם פרטי + משפחה"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
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
                <label>תפקיד</label>
                <input
                  placeholder="לדוגמה: מנהל משמרת"
                  value={form.role}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, role: e.target.value }))
                  }
                />
              </div>
              <div className="form-field">
                <label>טלפון</label>
                <input
                  placeholder="05X-XXXXXXX"
                  value={form.phone}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, phone: e.target.value }))
                  }
                />
              </div>
              <div className="form-field">
                <label>סטטוס</label>
                <select
                  value={form.status}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, status: e.target.value }))
                  }
                >
                  <option>פעיל</option>
                  <option>לא פעיל</option>
                </select>
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
              <button className="btn btn-primary" onClick={addEmployee}>
                הוסף עובד
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  const [user, setUser] = useState(null);
  const [activePage, setActivePage] = useState("dashboard");
  const [employees, setEmployees] = useState(initialEmployees);
  const [shifts, setShifts] = useState(initialShifts);
  const [calls, setCalls] = useState(initialCalls);
  const [checklist, setChecklist] = useState(initialChecklists);
  const [agentProfile, setAgentProfile] = useState(null);

  // Load agent profile from localStorage when user logs in / out
  useEffect(() => {
    if (user) {
      try {
        const stored = localStorage.getItem(`agent_profile_${user.id}`);
        if (stored) setAgentProfile(JSON.parse(stored));
      } catch {}
    } else {
      setAgentProfile(null);
    }
  }, [user]);

  const openCallsCount = calls.filter((c) => c.status === "פתוח").length;

  const pageTitle = {
    dashboard:  "דאשבורד ראשי 📊",
    shifts:     "סידור משמרות 🕐",
    calls:      "קריאות שירות 🔔",
    checklist:  "צ'קליסטים יומיים ✅",
    employees:  "ניהול עובדים 👥",
    marketing:  "שיווק ושימור לקוחות 🎯",
    broadcast:      "WhatsApp Broadcast 📨",
    broadcast_dash: "Broadcast Dashboard 📊",
    rooms:      "סטטוס חדרים 🏨",
    cleaning:   "QR ניקיון 🧹",
    bookings:   "הזמנות ובקרת תשלומים 💳",
    agent:      agentProfile ? `${agentProfile.display_name} 🤖` : "הסוכן שלי 🤖",
  };

  const today = new Date();
  const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  const dateStr = `${days[today.getDay()]}, ${today.getDate()}/${
    today.getMonth() + 1
  }/${today.getFullYear()}`;

  if (!user)
    return (
      <>
        <style>{css}</style>
        <LoginPage onLogin={setUser} />
      </>
    );

  const renderPage = () => {
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
          <EmployeesPage employees={employees} setEmployees={setEmployees} />
        );
      case "marketing":
        return <MarketingHub />;
      case "broadcast":
        return <WhatsAppBroadcast />;
      case "broadcast_dash":
        return <BroadcastDashboard />;
      case "rooms":
        return <RoomStatusBoard />;
      case "cleaning":
        return <CleaningQR />;
      case "bookings":
        return <BookingsManager />;
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
            onResetProfile={() => {
              localStorage.removeItem(`agent_profile_${user.id}`);
              setAgentProfile(null);
            }}
          />
        );
      default:
        return null;
    }
  };

  const mobileNav = [
    { id: "dashboard", icon: "📊", label: "ראשי" },
    { id: "shifts", icon: "🕐", label: "משמרות" },
    { id: "calls", icon: "🔔", label: "קריאות" },
    { id: "checklist", icon: "✅", label: "צ'קליסט" },
    { id: "agent", icon: "🤖", label: "סוכן" },
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
            onLogout={() => setUser(null)}
          />
          <div className="main">
            <div className="topbar">
              <div className="topbar-title">{pageTitle[activePage]}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div className="topbar-date">{dateStr}</div>
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "#C9A96E",
                  }}
                />
                <div
                  style={{ fontSize: 12, color: "#A8843A", fontWeight: 700 }}
                >
                  Dream Island
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
      </div>
    </>
  );
}
