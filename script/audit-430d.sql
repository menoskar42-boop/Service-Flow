-- ============================================================================
-- فحص بيانات 430D — بيدوّر على الصفوف اللى اتخزّنت غلط من رفعات سابقة.
-- الاستخدام (Replit Shell):   psql $DATABASE_URL -f script/audit-430d.sql
-- الملف **قراءة فقط** — مفيش أى UPDATE/DELETE. آمن تشغّله فى أى وقت.
-- ============================================================================

\echo '════════ ملخّص ════════'
SELECT 'تفاصيل (مغلقة)'      AS "الجدول", COUNT(*) AS "عدد الصفوف" FROM complaint_details
UNION ALL SELECT 'متبقى (تاريخى)', COUNT(*) FROM remaining_complaints
UNION ALL SELECT 'متبقى (الحالى)', COUNT(*) FROM remaining_complaints_current;

\echo ''
\echo '════════ (1) ساعات أكبر من الفرق الفعلى ════════'
\echo 'قيمة «فترة الاستمرار» المخزّنة أكبر من (الإغلاق − الشكوى). الاستبعاد بيقلّل'
\echo 'المدة ومايزوّدهاش، فالقيمة دى جت من عمود «Time untill now» الغلط أو من لقطة'
\echo 'قديمة. الأثر: عطل مقفول فى 23 ساعة بيظهر فى «تجاوزت 24 ساعة».'
SELECT src AS "المصدر", COUNT(*) AS "العدد",
       COUNT(*) FILTER (WHERE stored > 24 AND real <= 24) AS "منهم دخل تجاوزات 24 بالغلط",
       ROUND(MAX(stored - real), 1) AS "أكبر فرق (ساعة)"
FROM (
  SELECT 'تفاصيل' AS src, time_till_now AS stored,
         EXTRACT(EPOCH FROM (close_time - complain_time)) / 3600.0 AS real
    FROM complaint_details WHERE close_time IS NOT NULL AND time_till_now IS NOT NULL
  UNION ALL
  SELECT 'متبقى', time_till_now,
         EXTRACT(EPOCH FROM (close_time - complain_time)) / 3600.0
    FROM remaining_complaints WHERE close_time IS NOT NULL AND time_till_now IS NOT NULL
) q
WHERE stored > real + 0.2
GROUP BY src;

\echo ''
\echo 'أسوأ 20 صف:'
SELECT complain_no AS "رقم الشكوى", src AS "المصدر", status_code AS "الحالة",
       ROUND(stored, 1) AS "المخزّن", ROUND(real, 1) AS "الفعلى",
       ROUND(stored - real, 1) AS "الفرق",
       (complain_time AT TIME ZONE 'Africa/Cairo') AS "الشكوى",
       (close_time    AT TIME ZONE 'Africa/Cairo') AS "الإغلاق"
FROM (
  SELECT complain_no, 'تفاصيل' AS src, status_code, complain_time, close_time,
         time_till_now AS stored,
         EXTRACT(EPOCH FROM (close_time - complain_time)) / 3600.0 AS real
    FROM complaint_details WHERE close_time IS NOT NULL AND time_till_now IS NOT NULL
  UNION ALL
  SELECT complain_no, 'متبقى', status_code, complain_time, close_time, time_till_now,
         EXTRACT(EPOCH FROM (close_time - complain_time)) / 3600.0
    FROM remaining_complaints WHERE close_time IS NOT NULL AND time_till_now IS NOT NULL
) q
WHERE stored > real + 0.2
ORDER BY stored - real DESC LIMIT 20;

\echo ''
\echo '════════ (2) أعطال «مفتوحة للأبد» ════════'
\echo 'صفوف متبقى آخر لقطة شافتها 135 من غير وقت إغلاق، والعطل قديم. دى ساعاتها'
\echo 'بتتحسب (دلوقتى − وقت الشكوى) فبتكبر كل يوم وبتفضل فى «تجاوزت 24 ساعة» للأبد.'
SELECT COUNT(*) AS "العدد",
       COUNT(*) FILTER (WHERE NOT EXISTS (
         SELECT 1 FROM complaint_details cd WHERE cd.complain_no = rc.complain_no)) AS "منهم ملهوش صف فى التفاصيل"
FROM remaining_complaints rc
WHERE FLOOR(status_code::numeric)::int = 135
  AND close_time IS NULL
  AND complain_time < now() - interval '7 days';

SELECT complain_no AS "رقم الشكوى", phone_number AS "التليفون", exchange_name AS "السنترال",
       (complain_time AT TIME ZONE 'Africa/Cairo') AS "الشكوى",
       ROUND(EXTRACT(EPOCH FROM (now() - complain_time)) / 86400.0)::int AS "من كام يوم",
       EXISTS (SELECT 1 FROM complaint_details cd WHERE cd.complain_no = rc.complain_no) AS "له صف فى التفاصيل"
FROM remaining_complaints rc
WHERE FLOOR(status_code::numeric)::int = 135
  AND close_time IS NULL
  AND complain_time < now() - interval '7 days'
ORDER BY complain_time LIMIT 20;

\echo ''
\echo '════════ (3) صفوف من غير «فترة استمرار» ════════'
\echo 'الرقم العشرى النصّى («0.39») كان بيترمى قبل الإصلاح. الصفوف دى ساعاتها'
\echo 'بتتحسب من التوقيتين — صح، بس القيمة الرسمية ضايعة.'
SELECT 'تفاصيل' AS "الجدول",
       COUNT(*) FILTER (WHERE time_till_now IS NULL) AS "بدون فترة استمرار",
       COUNT(*) FILTER (WHERE time_till_now_full IS NULL) AS "بدون الفترة الكلية",
       COUNT(*) AS "الإجمالى"
  FROM complaint_details
UNION ALL
SELECT 'متبقى',
       COUNT(*) FILTER (WHERE time_till_now IS NULL),
       COUNT(*) FILTER (WHERE time_till_now_full IS NULL),
       COUNT(*)
  FROM remaining_complaints;

\echo ''
\echo '════════ (4) فجوات فى التواريخ (رفعات فشلت) ════════'
\echo 'أى يوم مفيهوش ولا شكوى مسجّلة غالباً رفعته فشلت (كانت بترجّع 500 على أى'
\echo 'ملف تواريخه أرقام Excel). قارن الأيام دى بأيام العمل الفعلية.'
WITH days AS (
  SELECT generate_series(
    (SELECT MIN(complain_time) FROM complaint_details)::date,
    LEAST((SELECT MAX(complain_time) FROM complaint_details)::date, now()::date),
    interval '1 day')::date AS d
)
SELECT d AS "اليوم"
FROM days
WHERE NOT EXISTS (
  SELECT 1 FROM complaint_details cd
   WHERE (cd.complain_time AT TIME ZONE 'Africa/Cairo')::date = days.d)
ORDER BY d;
