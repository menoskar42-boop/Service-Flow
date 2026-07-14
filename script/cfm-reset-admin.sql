-- إعادة ضبط باسورد admin بتاع الكوابل (cfm_users) إلى: Mon_oskar11
-- (هاش bcrypt متوافق مع bcryptjs)
-- التشغيل فى شيل Replit بتاع Service-Flow:
--     psql "$DATABASE_URL" -f script/cfm-reset-admin.sql
UPDATE cfm_users
SET password = '$2b$10$/Vd5QZju2YtZfFHV5CbZZutjBHbgO7fFHFd.m6TlZjRGdJY3QIWTG',
    is_initial_password = false
WHERE username = 'admin';

-- تأكيد:
SELECT username, name, role, left(password, 7) AS pass_prefix FROM cfm_users WHERE username = 'admin';
