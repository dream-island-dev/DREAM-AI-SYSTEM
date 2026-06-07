// src/googleAuth.js
// טוען את Google Identity Services ומצייר כפתור "התחבר עם Google".
// בהצלחה מחזיר ID Token (JWT) שנשלח ל-Backend לאימות.

const CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("failed_to_load_gsi"));
    document.head.appendChild(s);
  });
}

/**
 * מאתחל את Google Sign-In ומצייר כפתור לתוך אלמנט #gsi-button.
 * onCredential נקרא עם אובייקט { credential } (ה-ID Token) לאחר התחברות מוצלחת.
 */
export async function initGoogleSignIn(onCredential) {
  if (!CLIENT_ID) {
    console.error("חסר REACT_APP_GOOGLE_CLIENT_ID במשתני הסביבה");
    return;
  }
  await loadScript("https://accounts.google.com/gsi/client");
  window.google.accounts.id.initialize({
    client_id: CLIENT_ID,
    callback: (resp) => onCredential(resp),
    auto_select: false,
  });
  const el = document.getElementById("gsi-button");
  if (el) {
    window.google.accounts.id.renderButton(el, {
      theme: "filled_blue",
      size: "large",
      shape: "pill",
      text: "signin_with",
      locale: "he",
    });
  }
}
