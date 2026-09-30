const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

// פונקציה לשליפת התאריך הנוכחי בישראל
function getIsraelDate() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Jerusalem',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
    });
    const parts = formatter.formatToParts(now);
    const dateObj = {};
    parts.forEach(p => dateObj[p.type] = p.value);
    return {
        year: dateObj.year,
        month: dateObj.month,
        day: dateObj.day
    };
}

// פונקציה לקריאה מה-API של zmanimboard
async function fetchZmanim(year, month, day) {
    const url = `https://zmanimboard.com/GetAllClientData.aspx/?CL_ID=1287&Lyear=${year}&Lmonth=${month}&Lday=${day}&UserPass=Bc3456`;
    console.log(`\n[API CALL] שולח בקשה לכתובת:\n${url}\n`);

    const response = await fetch(url);
    const data = await response.text();
    return { url, data };
}

// נתיב ראשי: ברגע שנכנסים לכתובת הדפדפן מקבלים את התוכן המלא
app.get('/', async (req, res) => {
    try {
        const { year, month, day } = getIsraelDate();
        const { url, data } = await fetchZmanim(year, month, day);

        console.log("========== תוצאה מה-API שהתקבלה בענן ==========");
        console.log(data);
        console.log("================================================");

        // החזרת התוצאה כטקסט פשוט כדי שיוצג בצורה נקייה בדפדפן
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(data);
    } catch (err) {
        console.error("שגיאה:", err);
        res.status(500).send("שגיאה בשליפת הנתונים: " + err.message);
    }
});

// הרצת השרת והדפסה ללוג מיד בעלייה ראשונה
app.listen(PORT, async () => {
    console.log(`השרת רץ על פורט ${PORT}`);
    
    // קריאה ראשונית אוטומטית בעליית השרת
    try {
        const { year, month, day } = getIsraelDate();
        const { data } = await fetchZmanim(year, month, day);
        console.log(">>> נתונים ראשוניים שהתקבלו בעת עליית השרת:");
        console.log(data);
    } catch (err) {
        console.error("שגיאה בקריאה הראשונית:", err.message);
    }
});
