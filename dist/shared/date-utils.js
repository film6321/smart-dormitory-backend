"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateAge = calculateAge;
const THAI_MONTHS = {
    มกราคม: 1,
    กุมภาพันธ์: 2,
    มีนาคม: 3,
    เมษายน: 4,
    พฤษภาคม: 5,
    มิถุนายน: 6,
    กรกฎาคม: 7,
    สิงหาคม: 8,
    กันยายน: 9,
    ตุลาคม: 10,
    พฤศจิกายน: 11,
    ธันวาคม: 12,
    มค: 1,
    กพ: 2,
    มีค: 3,
    เมย: 4,
    พค: 5,
    มิย: 6,
    กค: 7,
    สค: 8,
    กย: 9,
    ตค: 10,
    พย: 11,
    ธค: 12,
};
/**
 * Calculates age from a birth date string or Date object.
 * Supports standard ISO formats (YYYY-MM-DD), Thai format strings (DD Month BE/CE),
 * and handles Buddhist Era (B.E. 25xx) automatically.
 *
 * @param birthDate Date object or date string
 * @param referenceDate Optional reference date (defaults to current date)
 * @returns Age in years, or undefined if invalid date
 */
function calculateAge(birthDate, referenceDate = new Date()) {
    if (!birthDate)
        return undefined;
    let day;
    let month;
    let year;
    if (birthDate instanceof Date) {
        if (isNaN(birthDate.getTime()))
            return undefined;
        day = birthDate.getDate();
        month = birthDate.getMonth() + 1;
        year = birthDate.getFullYear();
    }
    else if (typeof birthDate === 'string') {
        const trimmed = birthDate.trim();
        if (!trimmed)
            return undefined;
        // Check for ISO date string YYYY-MM-DD or YYYY/MM/DD
        const isoMatch = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
        if (isoMatch) {
            year = parseInt(isoMatch[1], 10);
            month = parseInt(isoMatch[2], 10);
            day = parseInt(isoMatch[3], 10);
        }
        else {
            // Check for DD-MM-YYYY or DD/MM/YYYY
            const dmyMatch = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
            if (dmyMatch) {
                day = parseInt(dmyMatch[1], 10);
                month = parseInt(dmyMatch[2], 10);
                year = parseInt(dmyMatch[3], 10);
            }
            else {
                // Parse Thai text dates e.g. "15 มกราคม 2545" or "15 ม.ค. 2545"
                const numbers = trimmed.match(/\d+/gu)?.map(Number) ?? [];
                const cleanedThai = trimmed.replace(/\./g, '');
                const monthKey = Object.keys(THAI_MONTHS).find((m) => cleanedThai.includes(m));
                if (monthKey && numbers.length >= 2) {
                    day = numbers[0];
                    month = THAI_MONTHS[monthKey];
                    year = numbers[numbers.length - 1];
                }
                else if (numbers.length >= 3) {
                    const [first, second, third] = numbers;
                    if (first > 31) {
                        year = first;
                        month = second;
                        day = third;
                    }
                    else {
                        day = first;
                        month = second;
                        year = third;
                    }
                }
                else {
                    return undefined;
                }
            }
        }
    }
    else {
        return undefined;
    }
    const currentYear = referenceDate.getFullYear();
    // Normalize Buddhist Era (B.E.) to Christian Era (C.E.)
    const normalizedYear = year > currentYear + 100 ? year - 543 : year;
    if (day < 1 ||
        day > 31 ||
        month < 1 ||
        month > 12 ||
        normalizedYear < 1900 ||
        normalizedYear > currentYear) {
        return undefined;
    }
    let age = currentYear - normalizedYear;
    const currentMonth = referenceDate.getMonth() + 1;
    const currentDay = referenceDate.getDate();
    if (currentMonth < month || (currentMonth === month && currentDay < day)) {
        age -= 1;
    }
    return age >= 0 ? age : undefined;
}
