-- ════════════════════════════════════════════════════════════════════════════
--  Review 2 demo data (fresh installs only): SteelCorp retires 400 of its
--  purchased credits against its 2024 emissions report.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO registry.retirements (certificate_number, company_id, credit_id, quantity, beneficiary, reason, report_year, retired_by, retired_at)
VALUES ('RET-2024-' || LPAD(nextval('registry.retirement_cert_seq')::TEXT, 6, '0'),
        'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 400,
        'SteelCorp India Ltd', 'Offset of part of the 2024 Scope 1 emissions', 2024,
        'a0000000-0000-0000-0000-000000000002', NOW() - INTERVAL '20 days');
UPDATE compliance.emissions_reports SET credits_retired = 400
WHERE company_id = 'c0000000-0000-0000-0000-000000000001' AND report_year = 2024;
