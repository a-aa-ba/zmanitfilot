const express = require('express');
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ==========================================
// 1. פונקציות עזר לזמנים ושליפת נתונים
// ==========================================

function getIsraelDate() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Jerusalem',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
    });
    const parts = formatter.formatToParts(now);
    const dateObj = {};
    parts.forEach(p => dateObj[p.type] = p.value);
    return {
        year: dateObj.year,
        month: dateObj.month,
        day: dateObj.day,
        hour: parseInt(dateObj.hour, 10),
        minute: parseInt(dateObj.minute, 10),
        totalMinutes: parseInt(dateObj.hour, 10) * 60 + parseInt(dateObj.minute, 10)
    };
}

function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + (m || 0);
}

// פענוח קיצורי מקומות לעברית קריאה
function decodeLocation(locStr) {
    if (!locStr) return "";
    let clean = locStr.replace(/["\\]/g, '').trim();
    if (clean.includes("עז'נ") || clean.includes("עזנ")) return "עזרת נשים";
    if (clean.includes("בימ'ד") || clean.includes("בימד")) return "בית המדרש";
    if (clean.includes("אולם")) return "אולם";
    return clean;
}

// שליפת ועיבוד הנתונים מ-zmanimboard
async function fetchAndParseBoard() {
    const { year, month, day, totalMinutes } = getIsraelDate();
    const url = `https://zmanimboard.com/GetAllClientData.aspx/?CL_ID=1287&Lyear=${year}&Lmonth=${month}&Lday=${day}&UserPass=Bc3456`;
    
    const response = await fetch(url);
    const root = await response.json();
    
    const elementsData = JSON.parse(root.All_Styles_Elements);
    const nameIdx = elementsData.columns.indexOf('Name');
    const jsonIdx = elementsData.columns.indexOf('JSON');

    let cholRaw = null;
    let shabbatRaw = null;

    for (const row of elementsData.data) {
        if (row[nameIdx] === 'תפילות חול' && row[jsonIdx]) {
            cholRaw = JSON.parse(row[jsonIdx]);
        }
        if (row[nameIdx] === 'תפילות שבת' && row[jsonIdx]) {
            shabbatRaw = JSON.parse(row[jsonIdx]);
        }
    }

    // עיבוד תפילות חול
    const cholMinyanim = [];
    if (cholRaw && cholRaw.data) {
        for (const item of cholRaw.data) {
            const fullName = item[0] || "";
            const timeView = item[1] || "";
            const isTitle = item[3];

            // סינון שקיעות / כותרות
            if (isTitle || fullName.includes("שקיעה") || !timeView) continue;

            const parts = fullName.split('-');
            const prayerName = parts[0].trim();
            const location = decodeLocation(parts[1] || "");

            // קביעת סוג התפילה
            let category = "other";
            if (prayerName.includes("שחרית")) category = "shacharit";
            else if (prayerName.includes("מנחה")) category = "mincha";
            else if (prayerName.includes("מעריב") || prayerName.includes("ערבית")) category = "arvit";

            cholMinyanim.push({
                name: prayerName,
                time: timeView,
                minutes: timeToMinutes(timeView),
                location: location,
                category: category
            });
        }
    }

    // עיבוד תפילות שבת
    const shabbatMinyanim = [];
    if (shabbatRaw && shabbatRaw.data) {
        for (const item of shabbatRaw.data) {
            const fullName = item[0] || "";
            const timeView = item[1] || "";
            const isTitle = item[3];

            if (isTitle || fullName.includes("שקיעה") || !timeView) continue;

            const parts = fullName.split('-');
            const prayerName = parts[0].trim();
            const location = decodeLocation(parts[1] || "");

            shabbatMinyanim.push({
                name: prayerName,
                time: timeView,
                location: location
            });
        }
    }

    return { cholMinyanim, shabbatMinyanim, currentMinutes: totalMinutes };
}

// עזר: הרכבת מחרוזת שמע להקראת מניין
function buildMinyanTTS(minyan) {
    const [h, m] = minyan.time.split(':').map(Number);
    let str = `t-${minyan.name}.בשעה.n-${h}.t-ו.n-${m}.`;
    if (minyan.location) {
        str += `t-ב${minyan.location}.`;
    }
    return str;
}


// ==========================================
// 2. ניתוב שיחות - ימות המשיח (Yemot HaMashiach)
// ==========================================

// --- תפריט ראשי ---
app.all(['/', '/menu'], async (req, res) => {
    const input = req.query.main_menu;

    if (input === '1') return res.redirect('/closest');
    if (input === '2') return res.redirect('/chol');
    if (input === '3') return res.redirect('/shabbat');
    if (input === '4') {
        // שלוחה 4 - חיפוש מניין לפי שעה
        return res.send(`id_list_message=t-שלוחה זו בפיתוח&go_to_folder=/menu`);
    }

    // השמעת התפריט הראשי והמתנה להקשה
    let response = "id_list_message=";
    response += "t-ברוכים הבאים למוקד זמני התפילות.";
    response += "t-למניין הקרוב הקישו 1.";
    response += "t-לזמני תפילות החול הקישו 2.";
    response += "t-לזמני תפילות השבת הקרובה הקישו 3.";
    response += "t-לחיפוש מניין לפי שעה הקישו 4.&";
    response += "read=t-הקישו את בחירתכם=main_menu,no,1,1,7,Number,yes,";

    res.send(response);
});

// --- שלוחה 1: המניין הקרוב ---
app.all('/closest', async (req, res) => {
    try {
        const { cholMinyanim, currentMinutes } = await fetchAndParseBoard();
        
        if (cholMinyanim.length === 0) {
            return res.send(`id_list_message=t-לא נמצאו מניינים מעודכנים להיום&go_to_folder=/menu`);
        }

        // מיון המניינים לפי השעה
        cholMinyanim.sort((a, b) => a.minutes - b.minutes);

        // קבלת אינדקס מבוקש (אם המשתמש לחץ 'הבא' או 'הקודם')
        let index = req.query.idx !== undefined ? parseInt(req.query.idx, 10) : null;

        if (index === null || isNaN(index)) {
            index = cholMinyanim.findIndex(m => m.minutes >= currentMinutes);
            if (index === -1) {
                // כל מנייני היום כבר עברו - מציגים את המניין הראשון
                index = 0;
            }
        }

        const nav = req.query.nav;
        if (nav === '0') {
            // שמיעה חוזרת של אותו מניין
        } else if (nav === '1') {
            // מניין הבא
            index = (index + 1) % cholMinyanim.length;
        } else if (nav === '2') {
            // מניין הקודם
            index = (index - 1 + cholMinyanim.length) % cholMinyanim.length;
        } else if (nav === '3') {
            // מעבר לכל מנייני החול
            return res.redirect('/chol');
        } else if (nav === '4') {
            // תזכורת (בהמשך)
            return res.send(`id_list_message=t-אפשרות התזכורות תופעל בקרוב&go_to_folder=/closest?idx=${index}`);
        } else if (nav === '*') {
            return res.redirect('/menu');
        }

        const current = cholMinyanim[index];

        let response = `id_list_message=`;
        response += `t-המניין הוא.${buildMinyanTTS(current)}`;
        response += `t-לשמיעה חוזרת 0. למניין הבא 1. לקודם 2. לכל מנייני החול 3. לחזרה לתפריט הראשי כוכבית.&`;
        response += `read=t-בחרו=nav,no,1,1,7,Number,yes,,idx=${index}`;

        res.send(response);
    } catch (err) {
        console.error(err);
        res.send(`id_list_message=t-חלה שגיאה במערכת&go_to_folder=/menu`);
    }
});

// --- שלוחה 2: מנייני החול (שחרית, מנחה, מעריב) ---
app.all('/chol', async (req, res) => {
    try {
        const { cholMinyanim } = await fetchAndParseBoard();
        const type = req.query.type;

        if (!type) {
            // תפריט בחירת תפילה
            let menu = "id_list_message=";
            menu += "t-למנייני שחרית הקישו 1.";
            menu += "t-למנייני מנחה הקישו 2.";
            menu += "t-למנייני מעריב הקישו 3.";
            menu += "t-לחזרה לתפריט הראשי הקישו כוכבית.&";
            menu += "read=t-הקישו בחירה=type,no,1,1,7,Number,yes,";
            return res.send(menu);
        }

        if (type === '*') return res.redirect('/menu');

        let categoryName = "";
        let filterCat = "";
        if (type === '1') { filterCat = 'shacharit'; categoryName = "שחרית"; }
        else if (type === '2') { filterCat = 'mincha'; categoryName = "מנחה"; }
        else if (type === '3') { filterCat = 'arvit'; categoryName = "מעריב"; }
        else {
            return res.redirect('/chol');
        }

        const filtered = cholMinyanim.filter(m => m.category === filterCat);
        filtered.sort((a, b) => a.minutes - b.minutes);

        if (filtered.length === 0) {
            return res.send(`id_list_message=t-לא נמצאו מניינים לתפילת ${categoryName}&go_to_folder=/chol`);
        }

        let response = `id_list_message=t-מנייני תפילת ${categoryName}.`;
        for (const m of filtered) {
            response += buildMinyanTTS(m);
        }
        response += `t-לחזרה לתפריט הקודם הקישו 1. לתפריט הראשי הקישו כוכבית.&`;
        response += `read=t-בחירה=back_choice,no,1,1,7,Number,yes,`;

        const back = req.query.back_choice;
        if (back === '1') return res.redirect('/chol');
        if (back === '*') return res.redirect('/menu');

        res.send(response);
    } catch (err) {
        console.error(err);
        res.send(`id_list_message=t-חלה שגיאה בשליפת הנתונים&go_to_folder=/menu`);
    }
});

// --- שלוחה 3: מנייני השבת ---
app.all('/shabbat', async (req, res) => {
    try {
        const { shabbatMinyanim } = await fetchAndParseBoard();

        if (shabbatMinyanim.length === 0) {
            return res.send(`id_list_message=t-לא נמצאו מנייני שבת מעודכנים&go_to_folder=/menu`);
        }

        let response = `id_list_message=t-זמני תפילות השבת הקרובה.`;
        for (const m of shabbatMinyanim) {
            const [h, mnt] = m.time.split(':').map(Number);
            response += `t-${m.name}.בשעה.n-${h}.t-ו.n-${mnt}.`;
            if (m.location) response += `t-ב${m.location}.`;
        }
        response += `t-לחזרה לתפריט הראשי הקישו כוכבית.&`;
        response += `read=t-הקש כוכבית לחזרה=back_main,no,1,1,7,Number,yes,`;

        if (req.query.back_main === '*') return res.redirect('/menu');

        res.send(response);
    } catch (err) {
        console.error(err);
        res.send(`id_list_message=t-חלה שגיאה&go_to_folder=/menu`);
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
