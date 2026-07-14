-- ============================================================================
-- cfm-migration.sql — نقل بيانات Cable-Fault-Manager إلى قاعدة Service-Flow
-- التشغيل (فى شيل Replit بتاع Service-Flow، بعد Republish عشان الجداول تتعمل):
--     psql "$DATABASE_URL" -f script/cfm-migration.sql
-- - أعمدة صريحة فى كل INSERT (مستقلة عن ترتيب الأعمدة الفيزيائى).
-- - ON CONFLICT (id) DO NOTHING → آمن لو اتشغّل أكتر من مرة.
-- - users → cfm_users. لا يُنقل user_sessions (جلسات مؤقتة).
-- ============================================================================
BEGIN;

-- ===== centrals =====
INSERT INTO centrals (id, name, code, created_at) VALUES
('66fcc498-eaf4-4128-a1f6-932669a0d31d', 'الغنايم', 'GHNAT', '2026-01-22 10:56:58.458464'),
('cf17d437-50d4-41bf-bef9-b024374e28f0', 'الغنايم -دير الجنادله', 'DRGAT', '2026-01-22 10:56:58.811392'),
('4bd95ce1-3ae6-4131-a334-93a32791632b', 'الغنايم -العزايزة', 'AMZAT', '2026-01-22 10:56:59.023567'),
('a4b290ca-36a6-4008-ada5-5802e8854ab3', 'الغنايم -نجع العمدة', 'NGOAT', '2026-01-22 10:56:59.235538'),
('7ba5c42e-752c-40a7-9522-35d35c5eae3e', 'امشول', 'DYRAT', '2026-01-24 08:18:01.179497'),
('6c95bd69-332b-40fe-bcc9-d3e277912c88', 'ابوتيج', 'ABOAT', '2026-01-24 09:02:33.393904')
ON CONFLICT (id) DO NOTHING;

-- ===== cfm_users (كان users) =====
INSERT INTO cfm_users (id, username, password, name, role, avatar, is_initial_password, created_at) VALUES
('3e81e201-b58f-452c-a89a-58bc95021c61', 'admin', '$2b$10$MmlidczsQ8FxG7ybOYPRQ.iUWfAR3Tb9HKLzK.SpKu2t8vmHITHlC', 'مدير النظام', 'admin', NULL, false, '2026-01-21 20:59:51.340187'),
('b6c38ed6-9294-45d9-84c6-5de5d4da18ad', 'engineer1', '$2b$10$ydZFZ1FnyzKkmkaJSnjdRu1TqPlJXDHKsRFoYKLtpBAsMfsUR.JMG', 'مهندس كوابل 1', 'cable_engineer', NULL, true, '2026-01-21 20:59:51.340187'),
('61d49bbd-2bb2-47a6-82a6-d122e18638fe', 'احمد', '$2b$10$N0dtt4Hgw6G/Jjz18xVlru8ezWNJh58kzdaPVFLTIAegHp9MiWsxC', 'احمد عبد المولى', 'splice_tech', NULL, true, '2026-01-24 09:45:32.439844'),
('a5e32b32-334a-4efd-a2aa-b9318a5d7c0c', 'splice1', '$2b$10$ydZFZ1FnyzKkmkaJSnjdRu1TqPlJXDHKsRFoYKLtpBAsMfsUR.JMG', 'جمال', 'splice_tech', NULL, true, '2026-01-21 20:59:51.340187'),
('30ac863c-164c-4183-a5df-996643a501e1', 'tech1', '$2b$10$eY9lX1TgsSnYrODcO88azubsJcIYKXEZlH1UTylId2KDyrZ92LDXq', 'فني شؤون خارجية 1', 'ext_tech', NULL, true, '2026-01-21 20:59:51.340187'),
('01e91642-cfe5-45b3-9348-4cf55fd049c8', 'حشمت', '$2b$10$n1pWfaplRuVJ7TZAfgqUweUUHNttmHCOtOgRdTLgEnFMj2YwF3bUK', 'حشمت عبد الصبور', 'external_affairs', NULL, true, '2026-01-24 17:13:33.141011'),
('43354959-f1dc-416f-ba78-d78b22c57073', 'انور', '$2b$10$GtN02vN0GUo8zJCFBZWiW.p8ojtm2OG92gX9Bzc9.jWoptw4l7fPW', 'انور عبد الفتاح', 'cable_engineer', NULL, true, '2026-01-24 17:14:41.39931')
ON CONFLICT (id) DO NOTHING;

-- ===== fault_types =====
INSERT INTO fault_types (id, name, category, created_at) VALUES
('d5f24c90-369f-4231-a99f-7b1a1915da3e', 'قطع كابل', 'cable', '2026-01-21 20:59:51.405043'),
('725b7cab-f67a-4953-b370-cd1742c1abf7', 'عزل منخفض', 'cable', '2026-01-21 20:59:51.405043'),
('ce482ba4-980b-4c82-a16e-5bae1d89cb91', 'تشويش خط', 'cable', '2026-01-21 20:59:51.405043'),
('46acf557-1173-4e67-af81-8ac3d1b0e87a', 'تلف كابينة', 'equipment', '2026-01-21 20:59:51.405043'),
('5d3b7d44-30f0-4578-8407-1b689af0b688', 'بوكس مكسور', 'equipment', '2026-01-21 20:59:51.405043'),
('5c317777-69f3-4237-95b2-a66583243915', 'قطع مينا', 'cable', '2026-01-24 08:47:43.743424')
ON CONFLICT (id) DO NOTHING;

-- ===== task_types =====
INSERT INTO task_types (id, name, created_at) VALUES
('728bcab3-daf4-4b67-8552-51bf47020572', 'وصله لحام 10 جوز', '2026-01-21 20:59:51.411041'),
('46104259-429a-4055-8a6e-f09cb3abeccd', 'وصله لحام 200 جوز', '2026-01-21 20:59:51.411041'),
('ef32fbd2-9d60-49b9-b42b-abb3d6777493', 'كابل 600', '2026-01-21 20:59:51.411041'),
('e68ae2c8-897c-4f74-ad1f-9320505deaa6', 'كابل 500', '2026-01-24 08:43:47.916938'),
('19a5799d-d0d9-431e-be9e-3554eeea511f', 'شش', '2026-02-01 09:39:43.936532'),
('262b9765-d164-4374-8039-81b6920f5f62', 'كابل 10 جوز', '2026-02-01 09:41:40.198872'),
('35de19a9-8d1d-4360-bbcb-34b650a2822d', 'كابل 20 جوز', '2026-02-01 09:41:40.452818'),
('f9870e49-00ac-431e-af5f-1256793be643', 'كابل 30 جوز', '2026-02-01 09:41:40.738139'),
('1302b0a8-dce0-4fd4-9dd6-477cd06b0e79', 'كابل 50 جوز', '2026-02-01 09:41:40.947844'),
('3c74533a-b04b-4c41-85cd-dfa1711e3f60', 'كابل 100 جوز', '2026-02-01 09:41:41.161205'),
('f875837a-8731-40a1-8a92-0032caa498bd', 'كابل 150 جوز', '2026-02-01 09:41:41.376825'),
('1ced7dd7-b57c-4599-aba7-0a752311bfed', 'كابل 200 جوز', '2026-02-01 09:41:41.603177'),
('55143c5a-010f-498f-8247-bd2059a4eb3f', 'كابل 250 جوز', '2026-02-01 09:41:41.814711'),
('f0873486-d0b2-4700-9117-c4653a2dc2f7', 'كابل 300 جوز', '2026-02-01 09:41:42.042829'),
('b5a3d3de-f915-47e8-96a7-7854a97cac6f', 'كابل 400 جوز', '2026-02-01 09:41:42.257544'),
('d2530216-b60e-4f0c-80cf-502c63e16cbc', 'كابل 500 جوز', '2026-02-01 09:41:42.472471'),
('8700d5e8-be2c-4460-8bd9-3b753a8c86d8', '   لحام  كابل 10 جوز', '2026-02-01 09:41:42.696316'),
('c0f317f8-b6d4-4558-81f5-c4ad207e4662', '   لحام  كابل 20 جوز', '2026-02-01 09:41:42.912852'),
('06fb7d88-aad0-448d-99bb-f7a97a54d00d', '   لحام  كابل 30 جوز', '2026-02-01 09:41:43.123994'),
('b7a41b8c-d130-4826-a65f-090cdfc94072', '   لحام  كابل 50 جوز', '2026-02-01 09:41:43.335833'),
('6b7c883c-e5fa-4cb5-8583-eadaf4c6ed4f', '   لحام  كابل 100 جوز', '2026-02-01 09:41:43.551726'),
('8391c115-588d-450b-bef5-0f51eecfc1ae', '   لحام  كابل 150 جوز', '2026-02-01 09:41:43.765253'),
('0d081897-d5dd-4bec-8483-70a4fd21984c', '   لحام  كابل 200 جوز', '2026-02-01 09:41:43.9766'),
('add241e3-d69f-4341-86eb-13e6e8b47259', '   لحام  كابل 250 جوز', '2026-02-01 09:41:44.185483'),
('c1c713e9-2e17-4f12-997d-dd9ff8c1d34c', '   لحام  كابل 300 جوز', '2026-02-01 09:41:44.395418'),
('6fa30dea-9553-42d3-b246-b6a27ee7c849', '   لحام  كابل 400 جوز', '2026-02-01 09:41:44.606265'),
('5bba8513-1b7d-4eca-8781-62c9a4b6fd4a', '   لحام  كابل 500 جوز', '2026-02-01 09:41:44.817259'),
('e8fd91c1-1ff9-40db-b592-268e905ab494', 'كونكتور', '2026-02-01 09:41:45.025249'),
('f0960ba8-acdd-4528-bac0-32b38cb67106', 'طلعه بكس', '2026-02-01 09:41:45.234147'),
('a7ac7427-f2a5-4d98-b1b4-541cc4341b81', 'بكس سعه 10 جوز', '2026-02-01 09:41:45.443398'),
('0dcfbaac-b404-4856-9e98-ab7235a0c0a2', 'ماسوره بولى ايثيلين عالى الكثافه', '2026-02-01 09:41:45.651999'),
('34c8c6f7-cbbb-4d45-b48b-df2538a07577', 'ماسوره 55مم', '2026-02-01 09:41:45.862817'),
('61d7dc93-34fc-4979-921a-a92df92e7f9c', 'ماسوره 110مم', '2026-02-01 09:41:46.073253'),
('298ce686-7ada-40fe-b302-3c0bbea34993', 'حفر ثانوى', '2026-02-01 09:41:46.286999'),
('737ae742-89d5-4470-b7fa-cee7fea0f090', 'حفر رئيسى', '2026-02-01 09:41:46.498134')
ON CONFLICT (id) DO NOTHING;

-- ===== contractors =====
INSERT INTO contractors (id, name, created_at) VALUES
('4e1999fd-23fa-4890-9c8e-cd76f7db5917', 'شركة القمر للمقاولات', '2026-01-21 20:59:51.413703'),
('8bf326b3-bbcb-48d5-a5be-554e8ec2a717', ' للمقاولات مؤسسة الأمل', '2026-01-21 20:59:51.413703'),
('0086d7d9-ef36-48c5-aec3-2e3ffcc6adba', 'شركه العز للمقاولات', '2026-01-24 08:44:51.497849')
ON CONFLICT (id) DO NOTHING;

-- ===== excavation_workers =====
INSERT INTO excavation_workers (id, name, national_id, created_at) VALUES
('676c3549-afe3-46b0-8686-3f482ab55c6f', 'عبد الرحمن', '2850805254448', '2026-01-25 12:58:51.942932'),
('fb877b78-ccaa-45b9-b30a-9d2af650d4d0', 'ناجح', '256695254266', '2026-01-25 13:30:42.867846')
ON CONFLICT (id) DO NOTHING;

-- ===== work_types =====
INSERT INTO work_types (id, name, created_at, associated_materials) VALUES
('0f70c77f-2c47-40ce-931b-5558179151cb', 'حفر ثان', '2026-01-21 20:59:51.408173', NULL),
('289953f2-7aae-4c12-b34d-e1c255f524ca', 'عامل حفر', '2026-01-25 12:14:19.596471', NULL),
('7ae474c0-d6f8-4503-985b-0600709a8a71', 'عمل    لحام  كابل 20 جوز', '2026-02-01 09:49:28.856348', NULL),
('2d71454a-0c2a-4fbb-b0c7-02773321811b', 'عمل    لحام  كابل 30 جوز', '2026-02-01 09:49:29.067895', NULL),
('f9e68ce2-c24b-4e35-ad70-ac1fe2a518bf', 'عمل    لحام  كابل 50 جوز', '2026-02-01 09:49:29.280388', NULL),
('4338b793-00a1-4da9-ad7e-cb28c0a48318', 'عمل    لحام  كابل 100 جوز', '2026-02-01 09:49:29.508092', NULL),
('bdaa33b0-007a-406f-ae83-5196a5bec88a', 'عمل    لحام  كابل 150 جوز', '2026-02-01 09:49:29.719021', NULL),
('333bbe6c-ba65-4f16-8cce-cd197a1b953f', 'عمل    لحام  كابل 200 جوز', '2026-02-01 09:49:29.929641', NULL),
('6125cad3-d909-46dc-8a67-d7ecc6323efa', 'عمل    لحام  كابل 250 جوز', '2026-02-01 09:49:30.141102', NULL),
('4f4d52b5-a76f-41fb-8ca4-c908479b08a7', 'عمل    لحام  كابل 300 جوز', '2026-02-01 09:49:30.353164', NULL),
('36c5aff2-d6ef-43cf-9adf-beeb6099f82b', 'عمل    لحام  كابل 400 جوز', '2026-02-01 09:49:30.565213', NULL),
('438f2f1d-4f30-4f99-a110-d80a43d83351', 'عمل    لحام  كابل 500 جوز', '2026-02-01 09:49:30.777786', NULL),
('c740921d-0221-4756-889b-565e4b03cd9e', 'رمى كابل 10 جوز', '2026-02-01 09:49:30.994884', NULL),
('fa716dd3-0582-4670-a237-4541db14f532', 'رمى كابل 20 جوز', '2026-02-01 09:49:31.210062', NULL),
('8a5eee66-df03-4f89-b4b6-2e2640146349', 'رمى كابل 30 جوز', '2026-02-01 09:49:31.424551', NULL),
('2f883e63-1562-461c-a6c2-2d674a597d40', 'رمى كابل 50 جوز', '2026-02-01 09:49:31.641624', NULL),
('faf74b1a-04fc-4160-8397-89f6871b5e8e', 'رمى كابل 100 جوز', '2026-02-01 09:49:31.852107', NULL),
('4c2864c6-ad33-4635-9ec9-e1b277d9d0fb', 'رمى كابل 150 جوز', '2026-02-01 09:49:32.063005', NULL),
('b89954d4-4337-4165-a527-20d87041eda8', 'رمى كابل 200 جوز', '2026-02-01 09:49:32.27585', NULL),
('d49ccd38-4e8a-4f18-960a-604e324d3623', 'رمى كابل 250 جوز', '2026-02-01 09:49:32.488154', NULL),
('52aea376-d45f-4730-a553-93a5de3da9f0', 'رمى كابل 300 جوز', '2026-02-01 09:49:32.716006', NULL),
('bfeaca0e-4972-4aa6-a282-41d7c835a6b0', 'رمى كابل 400 جوز', '2026-02-01 09:49:32.927871', NULL),
('2b01166b-bf18-4ab0-94ed-0a248abd6990', 'رمى كابل 500 جوز', '2026-02-01 09:49:33.139525', NULL),
('d08af0af-763f-4800-87d4-ebc0d04d700a', 'رمى ماسوره بولى ايثيلين عالى الكثافه', '2026-02-01 09:49:33.358382', NULL),
('7c9a2a24-7dc4-4995-85fe-29bda2dbb223', 'عامل حفر', '2026-02-01 09:49:33.568438', NULL),
('b6b6a44e-d52d-44a6-8ec6-335f028477d6', 'تركيب ماسوره 110 مم', '2026-02-01 09:49:33.780183', NULL),
('99c341bc-cec7-441a-a875-191a58a4e512', 'تركيب ماسوره 55 مم', '2026-02-01 09:49:33.991656', NULL),
('9442047f-57b2-4f05-8b9f-c863d9851af1', 'تركيب بكس ١٠ جوز بمشتملاته', '2026-02-01 11:12:58.553532', '[{"taskTypeId": "a7ac7427-f2a5-4d98-b1b4-541cc4341b81", "defaultQuantity": 1}, {"taskTypeId": "f0960ba8-acdd-4528-bac0-32b38cb67106", "defaultQuantity": 1}]'),
('49934551-3f13-40e8-89ae-64e866524ef7', 'عمل    لحام  كابل 10 جوز', '2026-02-01 09:49:28.609862', '[{"taskTypeId": "8700d5e8-be2c-4460-8bd9-3b753a8c86d8", "defaultQuantity": 1}, {"taskTypeId": "e8fd91c1-1ff9-40db-b592-268e905ab494", "defaultQuantity": 20}]'),
('a3ceb247-ee7e-43ca-a670-b3df601614af', 'حفر للبحث عن اعطال', '2026-05-03 06:45:24.779449', '[]')
ON CONFLICT (id) DO NOTHING;

-- ===== cables (ترتيب المصدر: id, central_id, number, type, created_at, cable_number, cabinet_number) =====
INSERT INTO cables (id, central_id, number, type, created_at, cable_number, cabinet_number) VALUES
('46085d46-5786-454f-bf8f-7bbc4826a628', '66fcc498-eaf4-4128-a1f6-932669a0d31d', '1-1', 'copper', '2026-01-24 09:03:28.558014', '1', '1'),
('f65b4ec9-4055-4a64-9478-dd219d758347', '66fcc498-eaf4-4128-a1f6-932669a0d31d', '1-2', 'copper', '2026-01-25 13:31:01.109152', '1', '2')
ON CONFLICT (id) DO NOTHING;

-- ===== tickets =====
INSERT INTO tickets (id, ticket_number, central_department, central_id, cable_id, cabinet, box, fault_type_id, notes, latitude, longitude, status, final_repair_id, final_repair_description, final_repair_repaired_at, final_repair_repaired_by, closed_at, closed_by, created_by, created_at, updated_at) VALUES
('fa256353-08dd-4b61-80df-30498d5c206c', 'TKT-2026-001', 'External Plant', '66fcc498-eaf4-4128-a1f6-932669a0d31d', '46085d46-5786-454f-bf8f-7bbc4826a628', '', '5566', 'ce482ba4-980b-4c82-a16e-5bae1d89cb91', 'شششش', 27.189711835812943, 31.18293622536335, 'open', NULL, NULL, NULL, NULL, NULL, NULL, '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-24 09:41:31.097638', '2026-01-24 17:09:50.225'),
('7f4e276e-a1cc-41bf-af7c-b39f9ba7d83a', 'TKT-2026-002', 'External Plant', '66fcc498-eaf4-4128-a1f6-932669a0d31d', '46085d46-5786-454f-bf8f-7bbc4826a628', '', '52', '725b7cab-f67a-4953-b370-cd1742c1abf7', '2458962', 27.189677444062223, 31.182941527705324, 'open', NULL, NULL, NULL, NULL, NULL, NULL, '01e91642-cfe5-45b3-9348-4cf55fd049c8', '2026-01-24 17:17:16.519021', '2026-01-24 17:29:50.23'),
('61a5fae2-296c-4813-bbba-3c1eba6cb08c', 'TKT-2026-004', 'External Plant', '66fcc498-eaf4-4128-a1f6-932669a0d31d', 'f65b4ec9-4055-4a64-9478-dd219d758347', '', '25', 'd5f24c90-369f-4231-a99f-7b1a1915da3e', '', NULL, NULL, 'open', NULL, NULL, NULL, NULL, NULL, NULL, '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-25 13:31:20.042603', '2026-01-25 13:31:20.042603'),
('a47be114-d3a1-4859-8e00-b9617e69fea2', 'TKT-2026-003', 'External Plant', '66fcc498-eaf4-4128-a1f6-932669a0d31d', '46085d46-5786-454f-bf8f-7bbc4826a628', '', '22', '46acf557-1173-4e67-af81-8ac3d1b0e87a', 'Ggg', NULL, NULL, 'closed', '12b753aa-c76f-4e4c-90ea-6d6cdf572c5f', 'Repair completed', '2026-01-25 05:34:35.571', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-27 06:36:19.666', '3e81e201-b58f-452c-a89a-58bc95021c61', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-25 05:33:37.619034', '2026-01-27 06:36:19.666'),
('ee51ada6-a2f9-4e94-939f-a5d986893c32', 'TKT-2026-005', 'External Plant', '66fcc498-eaf4-4128-a1f6-932669a0d31d', '46085d46-5786-454f-bf8f-7bbc4826a628', '', '45', '725b7cab-f67a-4953-b370-cd1742c1abf7', '', NULL, NULL, 'open', NULL, NULL, NULL, NULL, NULL, NULL, '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-28 13:13:09.13251', '2026-01-28 13:13:09.13251')
ON CONFLICT (id) DO NOTHING;

-- ===== measurement_entries =====
INSERT INTO measurement_entries (id, ticket_id, reading, distance, direction, notes, performed_by, created_by, recorded_at, created_at) VALUES
('270a01bc-0ae6-4065-ad51-4096249e3dc7', 'fa256353-08dd-4b61-80df-30498d5c206c', '100', 120, 'cable', '4425', 'احمد عبد المولى', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-24 17:21:43.478166', '2026-01-27 08:34:28.186321'),
('b0553647-6928-4759-ba9f-275638f5c852', 'fa256353-08dd-4b61-80df-30498d5c206c', 'N/A', 120, 'cabinet', 'نبضه لحام', 'جمال', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-24 17:25:25.247925', '2026-01-27 08:34:28.186321'),
('a85ef551-d13f-4a0c-ac69-be5537766d46', '7f4e276e-a1cc-41bf-af7c-b39f9ba7d83a', 'N/A', 150, 'cable', '', 'احمد عبد المولى', '61d49bbd-2bb2-47a6-82a6-d122e18638fe', '2026-01-24 17:28:25.422868', '2026-01-27 08:34:28.186321'),
('161208fa-eeb6-4de7-b5d0-3077b974ec85', '61a5fae2-296c-4813-bbba-3c1eba6cb08c', 'N/A', 120, 'cable', '', 'جمال', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-25 13:37:00.328202', '2026-01-27 08:34:28.186321'),
('27daf8ba-b37b-4f9b-bb77-e66255dbadb1', '7f4e276e-a1cc-41bf-af7c-b39f9ba7d83a', '55', 105, 'cabinet', 'تىتىتلا', 'احمد عبد المولى', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-27 08:27:17.371734', '2026-01-27 08:34:28.186321'),
('70313e3e-4424-4692-a7fb-eee4617e27f6', 'fa256353-08dd-4b61-80df-30498d5c206c', '50', 120, 'cable', 'قياس3', 'احمد عبد المولى', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-27 08:52:38.791255', '2026-01-27 00:00:00'),
('342bc16b-0bf2-4890-8040-c1b8d3b9157d', 'fa256353-08dd-4b61-80df-30498d5c206c', '10', 105, 'cabinet', 'قياس4', 'احمد عبد المولى', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-27 08:52:39.043274', '2026-01-27 00:00:00'),
('3617bfad-f61a-4276-8209-67633c39665d', 'fa256353-08dd-4b61-80df-30498d5c206c', 'N/A', 70, 'cable', '', 'مدير النظام', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-03-08 09:54:33.719639', '2026-03-08 12:00:00'),
('204e396d-29ce-401e-a887-98092829c5ae', 'fa256353-08dd-4b61-80df-30498d5c206c', 'N/A', 60, 'cable', '', 'مدير النظام', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-03-08 09:54:34.121228', '2026-03-08 12:00:00'),
('15039104-a300-4921-89c1-f53517cf8f84', 'fa256353-08dd-4b61-80df-30498d5c206c', 'N/A', 50, 'cable', '', 'مدير النظام', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-03-08 09:54:34.513869', '2026-03-08 12:00:00')
ON CONFLICT (id) DO NOTHING;

-- ===== work_entries =====
INSERT INTO work_entries (id, ticket_id, measurement_id, items, notes, performed_by, works_by, contractor_id, created_by, recorded_at, created_at) VALUES
('5c9c7f69-8b8c-4ef1-9fef-36edbb39c4ae', 'fa256353-08dd-4b61-80df-30498d5c206c', NULL, '[{"id":"hzdyn64fv","workTypeId":"36779941-7bf8-446d-afca-07c157909333","quantity":1}]', 'نننن', 'احمد عبد المولى', 'self', NULL, '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-24 17:25:49.980139', '2026-01-27 08:34:28.189828'),
('df7b9ffd-bfb3-44ad-9b95-f9736eee96f9', '7f4e276e-a1cc-41bf-af7c-b39f9ba7d83a', NULL, '[{"id":"dxb07ioog","workTypeId":"36779941-7bf8-446d-afca-07c157909333","quantity":20}]', '', 'احمد عبد المولى', 'contractor', '4e1999fd-23fa-4890-9c8e-cd76f7db5917', '61d49bbd-2bb2-47a6-82a6-d122e18638fe', '2026-01-24 17:30:33.738686', '2026-01-27 08:34:28.189828'),
('19404bed-7193-46d8-8096-2287ec6e1b35', '7f4e276e-a1cc-41bf-af7c-b39f9ba7d83a', NULL, '[{"id":"4jk6vg6dl","workTypeId":"0f70c77f-2c47-40ce-931b-5558179151cb","quantity":120}]', '', 'مدير النظام', 'contractor', '0086d7d9-ef36-48c5-aec3-2e3ffcc6adba', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-24 17:36:43.903182', '2026-01-27 08:34:28.189828'),
('a5971ba0-f719-440e-87ee-97dba6e7c434', 'fa256353-08dd-4b61-80df-30498d5c206c', NULL, '[{"id":"kfqnmtegb","workTypeId":"289953f2-7aae-4c12-b34d-e1c255f524ca","quantity":1,"excavationWorkerId":"676c3549-afe3-46b0-8686-3f482ab55c6f"}]', '', 'مدير النظام', 'self', NULL, '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-25 12:59:36.783051', '2026-01-27 08:34:28.189828'),
('d63e9ab8-5689-4ff5-a83d-4e509679a5ed', 'fa256353-08dd-4b61-80df-30498d5c206c', NULL, '[{"id":"l6muoo27b","workTypeId":"289953f2-7aae-4c12-b34d-e1c255f524ca","quantity":1,"excavationWorkerId":"676c3549-afe3-46b0-8686-3f482ab55c6f"}]', '', 'مدير النظام', 'contractor', '0086d7d9-ef36-48c5-aec3-2e3ffcc6adba', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-25 13:00:46.720499', '2026-01-27 08:34:28.189828'),
('e8bf5950-1c5b-48ef-aa46-b31ecd362ac5', '61a5fae2-296c-4813-bbba-3c1eba6cb08c', NULL, '[{"id":"vuneh0bhn","workTypeId":"289953f2-7aae-4c12-b34d-e1c255f524ca","quantity":1,"excavationWorkerId":"fb877b78-ccaa-45b9-b30a-9d2af650d4d0"}]', '', 'مدير النظام', 'contractor', '0086d7d9-ef36-48c5-aec3-2e3ffcc6adba', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-25 13:32:46.802859', '2026-01-27 08:34:28.189828'),
('0dc24fc4-efab-4c46-98bb-d33c87a46dd8', 'fa256353-08dd-4b61-80df-30498d5c206c', NULL, '[{"id":"gnjvxl8eg","workTypeId":"0f70c77f-2c47-40ce-931b-5558179151cb","quantity":1}]', '', 'مدير النظام', 'contractor', '8bf326b3-bbcb-48d5-a5be-554e8ec2a717', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-25 14:01:58.685545', '2026-01-27 08:34:28.189828'),
('9cfc48a7-8c8c-4750-b7e5-7699129021f2', '7f4e276e-a1cc-41bf-af7c-b39f9ba7d83a', NULL, '[{"id":"2kfqntkgh","workTypeId":"289953f2-7aae-4c12-b34d-e1c255f524ca","quantity":1,"excavationWorkerId":"fb877b78-ccaa-45b9-b30a-9d2af650d4d0"}]', '', 'مدير النظام', 'contractor', '4e1999fd-23fa-4890-9c8e-cd76f7db5917', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-25 14:04:05.756769', '2026-01-27 08:34:28.189828'),
('db25c1f1-0223-4472-b955-43cc70abc825', '7f4e276e-a1cc-41bf-af7c-b39f9ba7d83a', NULL, '[{"id":"derh38esn","workTypeId":"289953f2-7aae-4c12-b34d-e1c255f524ca","quantity":1,"excavationWorkerId":"676c3549-afe3-46b0-8686-3f482ab55c6f"}]', '', 'مدير النظام', 'contractor', '4e1999fd-23fa-4890-9c8e-cd76f7db5917', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-25 14:04:18.070247', '2026-01-27 08:34:28.189828'),
('8d8437d6-91c2-4f6b-8ef6-57d31055b204', '7f4e276e-a1cc-41bf-af7c-b39f9ba7d83a', NULL, '[{"id":"kkm6003w2","workTypeId":"289953f2-7aae-4c12-b34d-e1c255f524ca","quantity":1,"excavationWorkerId":"676c3549-afe3-46b0-8686-3f482ab55c6f"}]', '', 'مدير النظام', 'contractor', '4e1999fd-23fa-4890-9c8e-cd76f7db5917', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-25 14:06:14.089922', '2026-01-27 08:34:28.189828'),
('c39ccfed-a767-41d4-bf51-867aef938dbc', '61a5fae2-296c-4813-bbba-3c1eba6cb08c', NULL, '[{"id":"z6r3nhpjo","workTypeId":"289953f2-7aae-4c12-b34d-e1c255f524ca","quantity":1,"excavationWorkerId":"676c3549-afe3-46b0-8686-3f482ab55c6f"}]', '', 'احمد عبد المولى', 'contractor', '4e1999fd-23fa-4890-9c8e-cd76f7db5917', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-25 14:07:37.225613', '2026-01-27 08:34:28.189828'),
('9474e245-0698-4545-b3f6-e0d10d1dea73', 'fa256353-08dd-4b61-80df-30498d5c206c', NULL, '[{"id":"2c2avo00p","workTypeId":"36779941-7bf8-446d-afca-07c157909333","quantity":1},{"id":"9s8x837d3","workTypeId":"d62ed1a2-4bf5-4712-a5e8-9a47acbe355b","quantity":1}]', 'نننن', 'جمال', 'self', NULL, '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-27 08:36:03.336179', '2026-01-27 08:36:03.336179'),
('515cd932-5ef7-47da-8938-de3a53787428', 'fa256353-08dd-4b61-80df-30498d5c206c', NULL, '[{"id":"10p00w5vg","workTypeId":"d62ed1a2-4bf5-4712-a5e8-9a47acbe355b","quantity":20},{"id":"8h3x950c5","workTypeId":"36779941-7bf8-446d-afca-07c157909333","quantity":1}]', 'شسس', 'جمال', 'self', NULL, '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-27 08:54:50.386605', '2026-01-27 00:00:00'),
('23b7a139-6bed-43bc-9d34-0ecc736b415c', '7f4e276e-a1cc-41bf-af7c-b39f9ba7d83a', NULL, '[{"id":"d9sngcgqb","workTypeId":"9442047f-57b2-4f05-8b9f-c863d9851af1","quantity":1}]', '', 'جمال', 'self', NULL, '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-02-01 11:13:36.561758', '2026-02-01 00:00:00'),
('76ab0c61-23f5-43b8-8ce4-577e868b972f', '7f4e276e-a1cc-41bf-af7c-b39f9ba7d83a', NULL, '[{"id":"e8s97p0uz","workTypeId":"9442047f-57b2-4f05-8b9f-c863d9851af1","quantity":2}]', '', 'احمد عبد المولى', 'self', NULL, '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-02-01 11:17:39.983414', '2026-02-01 00:00:00'),
('2c7dfde5-a39f-4b59-9856-e3cd85461c60', 'fa256353-08dd-4b61-80df-30498d5c206c', NULL, '[{"id":"9cfuo8oie","workTypeId":"9442047f-57b2-4f05-8b9f-c863d9851af1","quantity":2}]', '', 'جمال', 'self', NULL, '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-02-01 11:19:28.080592', '2026-02-01 00:00:00'),
('30d7fad4-a5b0-417e-8850-18151b75502a', 'fa256353-08dd-4b61-80df-30498d5c206c', NULL, '[{"id":"1to1aig38","workTypeId":"49934551-3f13-40e8-89ae-64e866524ef7","quantity":1}]', '', 'احمد عبد المولى', 'self', NULL, '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-02-01 11:24:45.010004', '2026-02-01 00:00:00'),
('c828ebfd-a898-4e48-8dd2-444923a6e505', 'fa256353-08dd-4b61-80df-30498d5c206c', NULL, '[{"id":"buu9atk04","workTypeId":"49934551-3f13-40e8-89ae-64e866524ef7","quantity":1},{"id":"wlr8bwgyn","workTypeId":"9442047f-57b2-4f05-8b9f-c863d9851af1","quantity":1}]', '', 'مدير النظام', 'self', NULL, '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-02-03 10:34:53.195089', '2026-02-03 00:00:00'),
('04284cac-628d-4249-b495-0dbd449d03a1', 'ee51ada6-a2f9-4e94-939f-a5d986893c32', NULL, '[{"id":"xthfqrixy","workTypeId":"9442047f-57b2-4f05-8b9f-c863d9851af1","quantity":2},{"id":"kzb3ndssw","workTypeId":"49934551-3f13-40e8-89ae-64e866524ef7","quantity":3}]', '', 'احمد عبد المولى', 'self', NULL, '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-02-03 10:36:49.298314', '2026-02-03 00:00:00'),
('864fa907-872e-4239-a667-d48830b8710b', 'ee51ada6-a2f9-4e94-939f-a5d986893c32', NULL, '[{"id":"p3p8cnkmk","workTypeId":"49934551-3f13-40e8-89ae-64e866524ef7","quantity":1},{"id":"y74h2acjz","workTypeId":"7ae474c0-d6f8-4503-985b-0600709a8a71","quantity":1},{"id":"05tkras25","workTypeId":"9442047f-57b2-4f05-8b9f-c863d9851af1","quantity":1}]', '', 'احمد عبد المولى', 'self', NULL, '43354959-f1dc-416f-ba78-d78b22c57073', '2026-02-03 10:38:52.294951', '2026-02-03 00:00:00'),
('eb9e327a-537e-406d-82a2-8bb525f59797', 'fa256353-08dd-4b61-80df-30498d5c206c', NULL, '[{"id":"c11nevz4e","workTypeId":"49934551-3f13-40e8-89ae-64e866524ef7","quantity":1}]', '', 'احمد عبد المولى', 'self', NULL, '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-02-05 21:29:05.969017', '2026-02-04 12:00:00'),
('5e964e37-449d-4da5-8ef4-6e1697123d84', 'fa256353-08dd-4b61-80df-30498d5c206c', NULL, '[{"id":"5yxyx6tkn","workTypeId":"9442047f-57b2-4f05-8b9f-c863d9851af1","quantity":1}]', '', 'احمد عبد المولى', 'self', NULL, '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-02-05 21:30:19.948914', '2026-02-04 12:00:00'),
('ab2ba695-eca6-4c7c-966a-ade65fd6d40f', 'fa256353-08dd-4b61-80df-30498d5c206c', NULL, '[{"id":"mbktm7m1f","workTypeId":"49934551-3f13-40e8-89ae-64e866524ef7","quantity":1}]', '', 'جمال', 'self', NULL, '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-02-05 21:56:32.782313', '2026-02-03 12:00:00'),
('1328a48f-e20c-4eb2-9d5c-0a5ff88236e7', '7f4e276e-a1cc-41bf-af7c-b39f9ba7d83a', NULL, '[{"id":"o1qrsi2b3","workTypeId":"289953f2-7aae-4c12-b34d-e1c255f524ca","quantity":1,"excavationWorkerId":"fb877b78-ccaa-45b9-b30a-9d2af650d4d0"}]', '', 'مدير النظام', 'contractor', '4e1999fd-23fa-4890-9c8e-cd76f7db5917', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-02-05 21:58:14.6877', '2026-02-04 12:00:00'),
('cb95aefe-9193-4b09-ad3e-2078806fea5b', 'ee51ada6-a2f9-4e94-939f-a5d986893c32', NULL, '[{"id":"p8diu0pxt","workTypeId":"289953f2-7aae-4c12-b34d-e1c255f524ca","quantity":1,"excavationLength":20,"excavationWidth":30,"excavationDepth":70}]', '', 'مدير النظام', 'contractor', '4e1999fd-23fa-4890-9c8e-cd76f7db5917', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-05-03 06:46:30.784727', '2026-05-03 12:00:00'),
('e7fd1c59-e524-4c6a-b342-1cb63cbb0701', 'ee51ada6-a2f9-4e94-939f-a5d986893c32', NULL, '[{"id":"wrpxpnfqo","workTypeId":"a3ceb247-ee7e-43ca-a670-b3df601614af","quantity":0.729,"excavationLength":90,"excavationWidth":90,"excavationDepth":90}]', '', 'مدير النظام', 'contractor', '4e1999fd-23fa-4890-9c8e-cd76f7db5917', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-05-03 06:54:16.16069', '2026-05-03 12:00:00'),
('57ce4fd5-6bb7-4927-8c38-99bc00cdbd46', 'fa256353-08dd-4b61-80df-30498d5c206c', NULL, '[]', NULL, 'Test Engineer', NULL, NULL, '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-02-05 21:32:34.053042', '2026-01-15 12:00:00'),
('d6200dae-2e24-47df-a863-5704d7642e5c', 'fa256353-08dd-4b61-80df-30498d5c206c', NULL, '[]', NULL, 'Test Engineer2', NULL, NULL, '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-02-05 21:33:16.712056', '2025-12-25 12:00:00'),
('e7cefa57-3155-4665-b385-ff5fc77c54e5', 'fa256353-08dd-4b61-80df-30498d5c206c', NULL, '[]', NULL, 'Testing Date Fix', NULL, NULL, '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-02-05 21:34:48.069448', '2026-01-10 12:00:00')
ON CONFLICT (id) DO NOTHING;

-- ===== used_task_entries =====
INSERT INTO used_task_entries (id, ticket_id, measurement_id, items, notes, performed_by, created_by, recorded_at, created_at) VALUES
('c98d79da-3768-4851-86a1-525d0340e53f', 'fa256353-08dd-4b61-80df-30498d5c206c', NULL, '[{"id":"rkb8fkzjs","taskTypeId":"46104259-429a-4055-8a6e-f09cb3abeccd","quantity":5}]', 'ممم', 'احمد عبد المولى', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-24 17:26:11.625693', '2026-01-27 08:34:28.146891'),
('1f3a6e9d-fd12-43c9-ad4c-6449dd80fd81', '61a5fae2-296c-4813-bbba-3c1eba6cb08c', NULL, '[{"id":"9qqoo40g6","taskTypeId":"46104259-429a-4055-8a6e-f09cb3abeccd","quantity":3}]', '', 'احمد عبد المولى', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-25 13:33:36.813873', '2026-01-27 08:34:28.146891'),
('c4623630-3d58-448c-aa12-4d4dd4e3fd10', '61a5fae2-296c-4813-bbba-3c1eba6cb08c', NULL, '[{"id":"d7ww1uad9","taskTypeId":"ef32fbd2-9d60-49b9-b42b-abb3d6777493","quantity":1}]', '', 'احمد عبد المولى', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-25 13:33:57.943975', '2026-01-27 08:34:28.146891'),
('78e2119d-da1d-48a9-8616-b2aa79c6481f', 'fa256353-08dd-4b61-80df-30498d5c206c', NULL, '[{"id":"0jgaofqwn","taskTypeId":"728bcab3-daf4-4b67-8552-51bf47020572","quantity":1}]', 'ممم', 'احمد عبد المولى', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-01-27 08:56:35.838714', '2026-01-20 00:00:00'),
('c9400d2c-3808-4f8d-affe-d8d9edbb7e60', '7f4e276e-a1cc-41bf-af7c-b39f9ba7d83a', NULL, '[{"id":"hfhllvwk8","taskTypeId":"a7ac7427-f2a5-4d98-b1b4-541cc4341b81","quantity":1},{"id":"wkaj2loh0","taskTypeId":"f0960ba8-acdd-4528-bac0-32b38cb67106","quantity":1}]', 'تم إضافتها تلقائياً مع الأعمال', 'جمال', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-02-01 11:13:36.869673', '2026-02-01 00:00:00'),
('77afdd3e-8eb9-4a23-87c7-1d4d6d62f4d3', '7f4e276e-a1cc-41bf-af7c-b39f9ba7d83a', NULL, '[{"id":"ejm2uhhns","taskTypeId":"a7ac7427-f2a5-4d98-b1b4-541cc4341b81","quantity":2},{"id":"tatmrgv6b","taskTypeId":"f0960ba8-acdd-4528-bac0-32b38cb67106","quantity":2}]', 'تم إضافتها تلقائياً مع الأعمال', 'احمد عبد المولى', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-02-01 11:17:40.28914', '2026-02-01 00:00:00'),
('9cf0d289-7c78-408d-b4ac-2803cd400226', 'fa256353-08dd-4b61-80df-30498d5c206c', NULL, '[{"id":"xrkkq6vnu","taskTypeId":"a7ac7427-f2a5-4d98-b1b4-541cc4341b81","quantity":2},{"id":"3liyxfht4","taskTypeId":"f0960ba8-acdd-4528-bac0-32b38cb67106","quantity":2}]', 'تم إضافتها تلقائياً مع الأعمال', 'جمال', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-02-01 11:19:28.359803', '2026-02-01 00:00:00'),
('23bb0875-1e88-42ae-933f-6f461a71d93d', 'fa256353-08dd-4b61-80df-30498d5c206c', NULL, '[{"id":"swe7zxe70","taskTypeId":"8700d5e8-be2c-4460-8bd9-3b753a8c86d8","quantity":1},{"id":"cgmhlm8iw","taskTypeId":"e8fd91c1-1ff9-40db-b592-268e905ab494","quantity":20}]', 'تم إضافتها تلقائياً مع الأعمال', 'احمد عبد المولى', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-02-01 11:24:45.337576', '2026-02-01 00:00:00'),
('8d8b28f5-5b6e-4b05-a571-9e3bedb0b487', 'fa256353-08dd-4b61-80df-30498d5c206c', NULL, '[{"id":"s5gmuocbm","taskTypeId":"8700d5e8-be2c-4460-8bd9-3b753a8c86d8","quantity":1},{"id":"lhle4mkup","taskTypeId":"e8fd91c1-1ff9-40db-b592-268e905ab494","quantity":10},{"id":"ajdqugos8","taskTypeId":"a7ac7427-f2a5-4d98-b1b4-541cc4341b81","quantity":1}]', 'تم إضافتها مع الأعمال', 'مدير النظام', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-02-03 10:34:53.446298', '2026-02-03 00:00:00'),
('1c624f3c-e610-4f81-ade2-f4ed428f6dbc', 'ee51ada6-a2f9-4e94-939f-a5d986893c32', NULL, '[{"id":"qfovol12s","taskTypeId":"a7ac7427-f2a5-4d98-b1b4-541cc4341b81","quantity":2},{"id":"hccjv19ld","taskTypeId":"8700d5e8-be2c-4460-8bd9-3b753a8c86d8","quantity":3},{"id":"dcfsjp1l7","taskTypeId":"e8fd91c1-1ff9-40db-b592-268e905ab494","quantity":30}]', 'تم إضافتها مع الأعمال', 'احمد عبد المولى', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-02-03 10:36:49.563767', '2026-02-03 00:00:00'),
('368a9406-95f1-4c5f-9f42-5188bb42cdc9', 'ee51ada6-a2f9-4e94-939f-a5d986893c32', NULL, '[{"id":"lbz6a4tdj","taskTypeId":"8700d5e8-be2c-4460-8bd9-3b753a8c86d8","quantity":1},{"id":"1h78gn91y","taskTypeId":"e8fd91c1-1ff9-40db-b592-268e905ab494","quantity":20},{"id":"2fd5krkan","taskTypeId":"a7ac7427-f2a5-4d98-b1b4-541cc4341b81","quantity":1},{"id":"nd465ms7x","taskTypeId":"f0960ba8-acdd-4528-bac0-32b38cb67106","quantity":1},{"id":"ke8hgexf2","taskTypeId":"46104259-429a-4055-8a6e-f09cb3abeccd","quantity":1}]', 'تم إضافتها مع الأعمال', 'احمد عبد المولى', '43354959-f1dc-416f-ba78-d78b22c57073', '2026-02-03 10:38:52.563532', '2026-02-03 00:00:00'),
('93cf4a0b-e2b7-4ae5-b12f-f2e8a7b6ff0a', 'fa256353-08dd-4b61-80df-30498d5c206c', NULL, '[{"id":"38sernuqn","taskTypeId":"8700d5e8-be2c-4460-8bd9-3b753a8c86d8","quantity":1},{"id":"uidjwf88g","taskTypeId":"e8fd91c1-1ff9-40db-b592-268e905ab494","quantity":20}]', 'تم إضافتها مع الأعمال', 'احمد عبد المولى', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-02-05 21:29:06.507344', '2026-02-04 12:00:00'),
('b4642129-b988-4b57-bcca-6b3f6a3791e7', 'fa256353-08dd-4b61-80df-30498d5c206c', NULL, '[{"id":"yz8lwkxw6","taskTypeId":"a7ac7427-f2a5-4d98-b1b4-541cc4341b81","quantity":1},{"id":"7o9jm67sw","taskTypeId":"f0960ba8-acdd-4528-bac0-32b38cb67106","quantity":1}]', 'تم إضافتها مع الأعمال', 'احمد عبد المولى', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-02-05 21:30:20.18928', '2026-02-04 12:00:00'),
('be65c774-1593-4fe0-94c4-ba762524e8c6', 'fa256353-08dd-4b61-80df-30498d5c206c', NULL, '[{"id":"lnyrz6c15","taskTypeId":"8700d5e8-be2c-4460-8bd9-3b753a8c86d8","quantity":1},{"id":"z47mlpz3z","taskTypeId":"e8fd91c1-1ff9-40db-b592-268e905ab494","quantity":20}]', 'تم إضافتها مع الأعمال', 'جمال', '3e81e201-b58f-452c-a89a-58bc95021c61', '2026-02-05 21:56:33.078183', '2026-02-03 12:00:00')
ON CONFLICT (id) DO NOTHING;

-- ===== inventory_transactions =====
INSERT INTO inventory_transactions (id, type, task_type_id, quantity, date, ticket_id, notes, created_at) VALUES
('879f7d44-43b9-40e2-9bc3-9e58b585e28f', 'incoming', '46104259-429a-4055-8a6e-f09cb3abeccd', 100, '2026-01-24 00:00:00', NULL, NULL, '2026-01-24 17:15:08.489457'),
('fb025aaa-abd3-4395-a5ed-f23908b0ac30', 'incoming', 'ef32fbd2-9d60-49b9-b42b-abb3d6777493', 100, '2026-01-24 00:00:00', NULL, NULL, '2026-01-24 17:15:27.29235'),
('d2850e29-6b09-4ae3-b163-d44eeaef68c3', 'incoming', 'ef32fbd2-9d60-49b9-b42b-abb3d6777493', 100, '2026-01-24 00:00:00', NULL, NULL, '2026-01-24 17:20:08.756216'),
('c8fbf0fb-5475-4242-8f1b-4cb7d8784a3b', 'outgoing', '46104259-429a-4055-8a6e-f09cb3abeccd', 5, '2026-01-24 17:26:11.632', 'fa256353-08dd-4b61-80df-30498d5c206c', 'Used in ticket via task entry', '2026-01-24 17:26:11.633236'),
('51beac6f-20bd-4dd4-8b32-528123202587', 'outgoing', '46104259-429a-4055-8a6e-f09cb3abeccd', 3, '2026-01-25 13:33:36.85', '61a5fae2-296c-4813-bbba-3c1eba6cb08c', 'Used in ticket via task entry', '2026-01-25 13:33:36.85155'),
('5752494d-7db6-41d5-83a5-aa40f825a63b', 'outgoing', 'ef32fbd2-9d60-49b9-b42b-abb3d6777493', 1, '2026-01-25 13:33:57.948', '61a5fae2-296c-4813-bbba-3c1eba6cb08c', 'Used in ticket via task entry', '2026-01-25 13:33:57.949126'),
('1f2ae4e5-17ec-4341-80ec-efad497cae31', 'incoming', '46104259-429a-4055-8a6e-f09cb3abeccd', 200, '2026-01-27 00:00:00', NULL, NULL, '2026-01-27 08:55:29.102486'),
('998f9b9e-23b4-47c8-aca9-60dae95e90c7', 'incoming', '728bcab3-daf4-4b67-8552-51bf47020572', 10, '2026-01-27 00:00:00', NULL, NULL, '2026-01-27 08:55:59.876522'),
('84e197dc-1d2c-4b37-8194-a7bda626bf4b', 'outgoing', '728bcab3-daf4-4b67-8552-51bf47020572', 1, '2026-01-27 08:56:35.845', 'fa256353-08dd-4b61-80df-30498d5c206c', 'Used in ticket via task entry', '2026-01-27 08:56:35.845775'),
('110ed46a-dd52-4778-8067-f26771561288', 'outgoing', 'a7ac7427-f2a5-4d98-b1b4-541cc4341b81', 1, '2026-02-01 11:13:36.874', '7f4e276e-a1cc-41bf-af7c-b39f9ba7d83a', 'Used in ticket via task entry', '2026-02-01 11:13:36.875236'),
('3a007c58-c830-4794-abc3-17e1c43c1bb9', 'outgoing', 'f0960ba8-acdd-4528-bac0-32b38cb67106', 1, '2026-02-01 11:13:36.88', '7f4e276e-a1cc-41bf-af7c-b39f9ba7d83a', 'Used in ticket via task entry', '2026-02-01 11:13:36.881371'),
('d9202583-f44b-4939-89da-8eb56ae15f37', 'outgoing', 'a7ac7427-f2a5-4d98-b1b4-541cc4341b81', 2, '2026-02-01 11:17:40.291', '7f4e276e-a1cc-41bf-af7c-b39f9ba7d83a', 'Used in ticket via task entry', '2026-02-01 11:17:40.292271'),
('34fcbe67-73e9-4daa-9a68-afaf720779e6', 'outgoing', 'f0960ba8-acdd-4528-bac0-32b38cb67106', 2, '2026-02-01 11:17:40.306', '7f4e276e-a1cc-41bf-af7c-b39f9ba7d83a', 'Used in ticket via task entry', '2026-02-01 11:17:40.307586'),
('89519dc3-2182-4f48-a6e7-7c95285c15b8', 'outgoing', 'a7ac7427-f2a5-4d98-b1b4-541cc4341b81', 2, '2026-02-01 11:19:28.363', 'fa256353-08dd-4b61-80df-30498d5c206c', 'Used in ticket via task entry', '2026-02-01 11:19:28.364444'),
('55bbf8ad-57db-407b-b272-93ed15bdcc10', 'outgoing', 'f0960ba8-acdd-4528-bac0-32b38cb67106', 2, '2026-02-01 11:19:28.369', 'fa256353-08dd-4b61-80df-30498d5c206c', 'Used in ticket via task entry', '2026-02-01 11:19:28.369577'),
('5378020f-9510-4d00-b545-902c6675b627', 'outgoing', '8700d5e8-be2c-4460-8bd9-3b753a8c86d8', 1, '2026-02-01 11:24:45.341', 'fa256353-08dd-4b61-80df-30498d5c206c', 'Used in ticket via task entry', '2026-02-01 11:24:45.341872'),
('434ac2d6-49e7-4db5-906c-ad341dd50a17', 'outgoing', 'e8fd91c1-1ff9-40db-b592-268e905ab494', 20, '2026-02-01 11:24:45.345', 'fa256353-08dd-4b61-80df-30498d5c206c', 'Used in ticket via task entry', '2026-02-01 11:24:45.346032'),
('f075ae26-510a-4ad8-93e9-d2141cbf195d', 'outgoing', '8700d5e8-be2c-4460-8bd9-3b753a8c86d8', 1, '2026-02-03 10:34:53.449', 'fa256353-08dd-4b61-80df-30498d5c206c', 'Used in ticket via task entry', '2026-02-03 10:34:53.450672'),
('11d3eefa-9ff9-4973-a917-7accc82d1e9a', 'outgoing', 'e8fd91c1-1ff9-40db-b592-268e905ab494', 10, '2026-02-03 10:34:53.454', 'fa256353-08dd-4b61-80df-30498d5c206c', 'Used in ticket via task entry', '2026-02-03 10:34:53.454701'),
('8e8a7a80-6ded-4a9d-af4e-14e4768a8397', 'outgoing', 'a7ac7427-f2a5-4d98-b1b4-541cc4341b81', 1, '2026-02-03 10:34:53.457', 'fa256353-08dd-4b61-80df-30498d5c206c', 'Used in ticket via task entry', '2026-02-03 10:34:53.458375'),
('62638cbb-4eae-49e5-9bc2-79c350facf11', 'outgoing', 'a7ac7427-f2a5-4d98-b1b4-541cc4341b81', 2, '2026-02-03 10:36:49.567', 'ee51ada6-a2f9-4e94-939f-a5d986893c32', 'Used in ticket via task entry', '2026-02-03 10:36:49.567598'),
('eec815bb-e103-46ef-9434-5998b63650c8', 'outgoing', '8700d5e8-be2c-4460-8bd9-3b753a8c86d8', 3, '2026-02-03 10:36:49.57', 'ee51ada6-a2f9-4e94-939f-a5d986893c32', 'Used in ticket via task entry', '2026-02-03 10:36:49.571021'),
('b016965a-9907-483e-87af-b1c9cbff721d', 'outgoing', 'e8fd91c1-1ff9-40db-b592-268e905ab494', 30, '2026-02-03 10:36:49.573', 'ee51ada6-a2f9-4e94-939f-a5d986893c32', 'Used in ticket via task entry', '2026-02-03 10:36:49.574349'),
('acc09845-fb7e-4929-83e4-d2853e20584c', 'outgoing', '8700d5e8-be2c-4460-8bd9-3b753a8c86d8', 1, '2026-02-03 10:38:52.565', 'ee51ada6-a2f9-4e94-939f-a5d986893c32', 'Used in ticket via task entry', '2026-02-03 10:38:52.566317'),
('293a345f-2d3d-48c6-b0a6-aa6cf98a8a22', 'outgoing', 'e8fd91c1-1ff9-40db-b592-268e905ab494', 20, '2026-02-03 10:38:52.568', 'ee51ada6-a2f9-4e94-939f-a5d986893c32', 'Used in ticket via task entry', '2026-02-03 10:38:52.56896'),
('f0ff62dd-9c65-4e5c-8b66-fd483288ca8b', 'outgoing', 'a7ac7427-f2a5-4d98-b1b4-541cc4341b81', 1, '2026-02-03 10:38:52.582', 'ee51ada6-a2f9-4e94-939f-a5d986893c32', 'Used in ticket via task entry', '2026-02-03 10:38:52.582801'),
('bdb40981-9d55-447c-abad-171b5f720a9b', 'outgoing', 'f0960ba8-acdd-4528-bac0-32b38cb67106', 1, '2026-02-03 10:38:52.584', 'ee51ada6-a2f9-4e94-939f-a5d986893c32', 'Used in ticket via task entry', '2026-02-03 10:38:52.585078'),
('da1c46ef-ae6e-4973-9c1c-3f6ccc569a1f', 'outgoing', '46104259-429a-4055-8a6e-f09cb3abeccd', 1, '2026-02-03 10:38:52.587', 'ee51ada6-a2f9-4e94-939f-a5d986893c32', 'Used in ticket via task entry', '2026-02-03 10:38:52.587968'),
('6d95664e-0853-4ac1-a157-93da2ffed005', 'outgoing', '8700d5e8-be2c-4460-8bd9-3b753a8c86d8', 1, '2026-02-05 21:29:06.51', 'fa256353-08dd-4b61-80df-30498d5c206c', 'Used in ticket via task entry', '2026-02-05 21:29:06.511898'),
('c27b00f0-4d47-4666-bac0-b7aab2972dc9', 'outgoing', 'e8fd91c1-1ff9-40db-b592-268e905ab494', 20, '2026-02-05 21:29:06.515', 'fa256353-08dd-4b61-80df-30498d5c206c', 'Used in ticket via task entry', '2026-02-05 21:29:06.51609'),
('f377ae2b-a5a0-4143-8b01-4eaf90de696b', 'outgoing', 'a7ac7427-f2a5-4d98-b1b4-541cc4341b81', 1, '2026-02-05 21:30:20.191', 'fa256353-08dd-4b61-80df-30498d5c206c', 'Used in ticket via task entry', '2026-02-05 21:30:20.192224'),
('11a04143-ee21-451b-8ab1-59f7ead5594c', 'outgoing', 'f0960ba8-acdd-4528-bac0-32b38cb67106', 1, '2026-02-05 21:30:20.194', 'fa256353-08dd-4b61-80df-30498d5c206c', 'Used in ticket via task entry', '2026-02-05 21:30:20.195392'),
('5a5426ac-ad86-42ab-a35b-2a6b0afa9414', 'outgoing', '8700d5e8-be2c-4460-8bd9-3b753a8c86d8', 1, '2026-02-05 21:56:33.09', 'fa256353-08dd-4b61-80df-30498d5c206c', 'Used in ticket via task entry', '2026-02-05 21:56:33.090845'),
('ac739f02-3d92-4b89-845d-eef30d62c95d', 'outgoing', 'e8fd91c1-1ff9-40db-b592-268e905ab494', 20, '2026-02-05 21:56:33.096', 'fa256353-08dd-4b61-80df-30498d5c206c', 'Used in ticket via task entry', '2026-02-05 21:56:33.097996')
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- تحقّق سريع بعد التشغيل:
-- SELECT 'cfm_users' t, count(*) FROM cfm_users UNION ALL SELECT 'centrals', count(*) FROM centrals
--   UNION ALL SELECT 'cables', count(*) FROM cables UNION ALL SELECT 'fault_types', count(*) FROM fault_types
--   UNION ALL SELECT 'task_types', count(*) FROM task_types UNION ALL SELECT 'work_types', count(*) FROM work_types
--   UNION ALL SELECT 'contractors', count(*) FROM contractors UNION ALL SELECT 'excavation_workers', count(*) FROM excavation_workers
--   UNION ALL SELECT 'tickets', count(*) FROM tickets UNION ALL SELECT 'measurement_entries', count(*) FROM measurement_entries
--   UNION ALL SELECT 'work_entries', count(*) FROM work_entries UNION ALL SELECT 'used_task_entries', count(*) FROM used_task_entries
--   UNION ALL SELECT 'inventory_transactions', count(*) FROM inventory_transactions;
-- المتوقع: cfm_users 7 | centrals 6 | cables 2 | fault_types 6 | task_types 35 | work_types 31 | contractors 3 |
--          excavation_workers 2 | tickets 5 | measurement_entries 11 | work_entries 28 | used_task_entries 14 | inventory_transactions 34
