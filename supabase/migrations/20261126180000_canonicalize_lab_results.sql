-- Faz 2: Standart kan tahlili sözlüğü (canonical format) & mevcut verilerin normalizasyonu

alter table public.lab_results
  add column if not exists raw_name text,
  add column if not exists category text;

update public.lab_results
set raw_name = coalesce(raw_name, test_name);

with mapped as (
  select
    id,
    case
      -- Vitamin & Mineral
      when test_name in ('25-OH VİTAMİN D3') then 'Vitamin D (25-OH)'
      when test_name in ('Vitamin B12', 'VİTAMİN B12') then 'Vitamin B12'
      when test_name in ('Folat', 'FOLİK ASİT (FOLAT)') then 'Folat (B9)'
      when test_name in ('Ferritin', 'FERRİTİN') then 'Ferritin'
      when test_name in ('Demir', 'Demir (serum)') then 'Demir'
      when test_name in ('Demir Bağlama Kapasitesi', 'Demir bağlama kapasitesi (TDBK)') then 'Demir Bağlama (TDBK)'
      when test_name in ('Magnezyum', 'Magnezyum(Mg)') then 'Magnezyum'
      when test_name in ('Kalsiyum (Ca)') then 'Kalsiyum'
      when test_name in ('Fosfor (P)') then 'Fosfor'
      -- Kolesterol & Şeker
      when test_name in ('LDL KOLESTEROL', 'LDL Kolesterol (İndirekt, hesaplamalı)') then 'LDL Kolesterol'
      when test_name in ('HDL KOLESTEROL', 'HDL kolesterol') then 'HDL Kolesterol'
      when test_name in ('KOLESTEROL TOTAL', 'Kolesterol') then 'Total Kolesterol'
      when test_name in ('TRİGLİSERİD', 'Trigliserid') then 'Trigliserid'
      when test_name in ('GLUKOZ(AÇLIK)', 'Glukoz (Açlık Kan Şekeri)') then 'Glukoz (Açlık)'
      when test_name in ('Glike hemoglobin (Hb A1c)') then 'HbA1c'
      -- Karaciğer, Böbrek & Enzim
      when test_name in ('ALT (SGPT)', 'Alanin aminotransferaz (ALT)') then 'ALT'
      when test_name in ('AST (SGOT)', 'Aspartat transaminaz (AST)') then 'AST'
      when test_name in ('Gamma glutamil transferaz (GGT)') then 'GGT'
      when test_name in ('Alkalen fosfataz (ALP)') then 'ALP'
      when test_name in ('Laktat dehidrogenaz (LDH)') then 'LDH'
      when test_name in ('Kreatin kinaz (CK)') then 'Kreatin Kinaz (CK)'
      when test_name in ('Amilaz') then 'Amilaz'
      when test_name in ('Bilirubin (total)') then 'Bilirubin (Total)'
      when test_name in ('Bilirubin (direkt)') then 'Bilirubin (Direkt)'
      when test_name in ('Albümin') then 'Albümin'
      when test_name in ('Kreatinin', 'Kreatinin.') then 'Kreatinin'
      when test_name in ('eGFR Hesaplamasi.') then 'eGFR'
      when test_name in ('Üre (Serum/Plazma)') then 'Üre'
      when test_name in ('Ürik asit') then 'Ürik Asit'
      when test_name in ('C reaktif protein (CRP)', 'CRP,nefelometrik') then 'CRP'
      when test_name in ('SODYUM (Na,Serum)', 'Sodyum (Na)') then 'Sodyum'
      when test_name in ('POTASYUM ( K , Serum )', 'Potasyum (K)') then 'Potasyum'
      when test_name in ('Klor (Cl)') then 'Klor'
      -- Tiroid
      when test_name in ('TSH', 'TSH..') then 'TSH'
      when test_name in ('SERBEST T4', 'Serbest T4') then 'Serbest T4'
      when test_name in ('SERBEST T3') then 'Serbest T3'
      -- Kan Sayımı (Hemogram)
      when test_name in ('HGB', 'Tam Kan Sayımı (Hemogram) HGB') then 'Hemoglobin (HGB)'
      when test_name in ('HCT', 'Tam Kan Sayımı (Hemogram) HCT') then 'Hematokrit (HCT)'
      when test_name in ('WBC', 'Tam Kan Sayımı (Hemogram) WBC') then 'Lökosit (WBC)'
      when test_name in ('RBC', 'Tam Kan Sayımı (Hemogram) RBC') then 'Eritrosit (RBC)'
      when test_name in ('PLT', 'Tam Kan Sayımı (Hemogram) PLT') then 'Trombosit (PLT)'
      when test_name in ('MCV', 'Tam Kan Sayımı (Hemogram) MCV') then 'MCV'
      when test_name in ('MCH', 'Tam Kan Sayımı (Hemogram) MCH') then 'MCH'
      when test_name in ('MCHC', 'Tam Kan Sayımı (Hemogram) MCHC') then 'MCHC'
      when test_name in ('RDW-CV', 'Tam Kan Sayımı (Hemogram) RDW') then 'RDW'
      when test_name in ('RDW-SD') then 'RDW-SD'
      when test_name in ('MPV', 'Tam Kan Sayımı (Hemogram) MPV') then 'MPV'
      when test_name in ('PCT', 'Tam Kan Sayımı (Hemogram) PCT') then 'PCT'
      when test_name in ('PDW', 'Tam Kan Sayımı (Hemogram) PDW') then
        case when coalesce(unit, '') like '%\%%' escape '\' then 'PDW (%)' else 'PDW (fL)' end
      when test_name in ('P-LCR') then 'P-LCR'
      when test_name in ('% NEU', 'Tam Kan Sayımı (Hemogram) NEU%') then 'Nötrofil %'
      when test_name in ('NEU#', 'Tam Kan Sayımı (Hemogram) NEU#') then 'Nötrofil #'
      when test_name in ('% LYM', 'Tam Kan Sayımı (Hemogram) LYM%') then 'Lenfosit %'
      when test_name in ('LYM#', 'Tam Kan Sayımı (Hemogram) LYM#') then 'Lenfosit #'
      when test_name in ('% MON', 'Tam Kan Sayımı (Hemogram) MONO%') then 'Monosit %'
      when test_name in ('MON#', 'Tam Kan Sayımı (Hemogram) MONO#') then 'Monosit #'
      when test_name in ('% Eo', 'Tam Kan Sayımı (Hemogram) EOS%') then 'Eozinofil %'
      when test_name in ('EO#', 'Tam Kan Sayımı (Hemogram) EOS#') then 'Eozinofil #'
      when test_name in ('% BaS', 'Tam Kan Sayımı (Hemogram) BASO%') then 'Bazofil %'
      when test_name in ('BAS#', 'Tam Kan Sayımı (Hemogram) BASO#') then 'Bazofil #'
      -- Seroloji / Diğer
      when test_name in ('HBsAg', 'Anti HBs', 'Anti HCV', 'Anti HIV', 'VDRL-RPR') then test_name
      else test_name
    end as canon_name,
    case
      when test_name in ('25-OH VİTAMİN D3', 'Vitamin B12', 'VİTAMİN B12', 'Folat', 'FOLİK ASİT (FOLAT)', 'Ferritin', 'FERRİTİN', 'Demir', 'Demir (serum)', 'Demir Bağlama Kapasitesi', 'Demir bağlama kapasitesi (TDBK)', 'Magnezyum', 'Magnezyum(Mg)', 'Kalsiyum (Ca)', 'Fosfor (P)') then 'vitamin'
      when test_name in ('LDL KOLESTEROL', 'LDL Kolesterol (İndirekt, hesaplamalı)', 'HDL KOLESTEROL', 'HDL kolesterol', 'KOLESTEROL TOTAL', 'Kolesterol', 'TRİGLİSERİD', 'Trigliserid', 'GLUKOZ(AÇLIK)', 'Glukoz (Açlık Kan Şekeri)', 'Glike hemoglobin (Hb A1c)') then 'lipid'
      when test_name in ('ALT (SGPT)', 'Alanin aminotransferaz (ALT)', 'AST (SGOT)', 'Aspartat transaminaz (AST)', 'Gamma glutamil transferaz (GGT)', 'Alkalen fosfataz (ALP)', 'Laktat dehidrogenaz (LDH)', 'Kreatin kinaz (CK)', 'Amilaz', 'Bilirubin (total)', 'Bilirubin (direkt)', 'Albümin', 'Kreatinin', 'Kreatinin.', 'eGFR Hesaplamasi.', 'Üre (Serum/Plazma)', 'Ürik asit', 'C reaktif protein (CRP)', 'CRP,nefelometrik', 'SODYUM (Na,Serum)', 'Sodyum (Na)', 'POTASYUM ( K , Serum )', 'Potasyum (K)', 'Klor (Cl)') then 'organ'
      when test_name in ('TSH', 'TSH..', 'SERBEST T4', 'Serbest T4', 'SERBEST T3') then 'tiroid'
      when test_name in ('HGB', 'Tam Kan Sayımı (Hemogram) HGB', 'HCT', 'Tam Kan Sayımı (Hemogram) HCT', 'WBC', 'Tam Kan Sayımı (Hemogram) WBC', 'RBC', 'Tam Kan Sayımı (Hemogram) RBC', 'PLT', 'Tam Kan Sayımı (Hemogram) PLT', 'MCV', 'Tam Kan Sayımı (Hemogram) MCV', 'MCH', 'Tam Kan Sayımı (Hemogram) MCH', 'MCHC', 'Tam Kan Sayımı (Hemogram) MCHC', 'RDW-CV', 'Tam Kan Sayımı (Hemogram) RDW', 'RDW-SD', 'MPV', 'Tam Kan Sayımı (Hemogram) MPV', 'PCT', 'Tam Kan Sayımı (Hemogram) PCT', 'PDW', 'Tam Kan Sayımı (Hemogram) PDW', 'P-LCR', '% NEU', 'Tam Kan Sayımı (Hemogram) NEU%', 'NEU#', 'Tam Kan Sayımı (Hemogram) NEU#', '% LYM', 'Tam Kan Sayımı (Hemogram) LYM%', 'LYM#', 'Tam Kan Sayımı (Hemogram) LYM#', '% MON', 'Tam Kan Sayımı (Hemogram) MONO%', 'MON#', 'Tam Kan Sayımı (Hemogram) MONO#', '% Eo', 'Tam Kan Sayımı (Hemogram) EOS%', 'EO#', 'Tam Kan Sayımı (Hemogram) EOS#', '% BaS', 'Tam Kan Sayımı (Hemogram) BASO%', 'BAS#', 'Tam Kan Sayımı (Hemogram) BASO#') then 'hemogram'
      else 'other'
    end as canon_cat,
    case
      when test_name in ('25-OH VİTAMİN D3', 'Folat', 'FOLİK ASİT (FOLAT)', 'Ferritin', 'FERRİTİN') then 'ng/mL'
      when test_name in ('Vitamin B12', 'VİTAMİN B12') then 'pg/mL'
      when test_name in ('Demir', 'Demir (serum)', 'Demir Bağlama Kapasitesi', 'Demir bağlama kapasitesi (TDBK)') then 'µg/dL'
      when test_name in ('Magnezyum', 'Magnezyum(Mg)', 'Kalsiyum (Ca)', 'Fosfor (P)', 'LDL KOLESTEROL', 'LDL Kolesterol (İndirekt, hesaplamalı)', 'HDL KOLESTEROL', 'HDL kolesterol', 'KOLESTEROL TOTAL', 'Kolesterol', 'TRİGLİSERİD', 'Trigliserid', 'GLUKOZ(AÇLIK)', 'Glukoz (Açlık Kan Şekeri)', 'Bilirubin (total)', 'Bilirubin (direkt)', 'Kreatinin', 'Kreatinin.', 'Üre (Serum/Plazma)', 'Ürik asit') then 'mg/dL'
      when test_name in ('Glike hemoglobin (Hb A1c)', 'HCT', 'Tam Kan Sayımı (Hemogram) HCT', 'RDW-CV', 'Tam Kan Sayımı (Hemogram) RDW', 'PCT', 'Tam Kan Sayımı (Hemogram) PCT', 'P-LCR', '% NEU', 'Tam Kan Sayımı (Hemogram) NEU%', '% LYM', 'Tam Kan Sayımı (Hemogram) LYM%', '% MON', 'Tam Kan Sayımı (Hemogram) MONO%', '% Eo', 'Tam Kan Sayımı (Hemogram) EOS%', '% BaS', 'Tam Kan Sayımı (Hemogram) BASO%') then '%'
      when test_name in ('ALT (SGPT)', 'Alanin aminotransferaz (ALT)', 'AST (SGOT)', 'Aspartat transaminaz (AST)', 'Gamma glutamil transferaz (GGT)', 'Alkalen fosfataz (ALP)', 'Laktat dehidrogenaz (LDH)', 'Kreatin kinaz (CK)', 'Amilaz') then 'U/L'
      when test_name in ('eGFR Hesaplamasi.') then 'mL/dk'
      when test_name in ('C reaktif protein (CRP)', 'CRP,nefelometrik') then 'mg/L'
      when test_name in ('SODYUM (Na,Serum)', 'Sodyum (Na)', 'POTASYUM ( K , Serum )', 'Potasyum (K)', 'Klor (Cl)') then 'mmol/L'
      when test_name in ('TSH', 'TSH..') then 'mIU/L'
      when test_name in ('SERBEST T4', 'Serbest T4') then 'ng/dL'
      when test_name in ('SERBEST T3') then 'pg/mL'
      when test_name in ('HGB', 'Tam Kan Sayımı (Hemogram) HGB', 'MCHC', 'Tam Kan Sayımı (Hemogram) MCHC') then 'g/dL'
      when test_name in ('WBC', 'Tam Kan Sayımı (Hemogram) WBC', 'PLT', 'Tam Kan Sayımı (Hemogram) PLT', 'NEU#', 'Tam Kan Sayımı (Hemogram) NEU#', 'LYM#', 'Tam Kan Sayımı (Hemogram) LYM#', 'MON#', 'Tam Kan Sayımı (Hemogram) MONO#', 'EO#', 'Tam Kan Sayımı (Hemogram) EOS#', 'BAS#', 'Tam Kan Sayımı (Hemogram) BASO#') then '10^3/µL'
      when test_name in ('RBC', 'Tam Kan Sayımı (Hemogram) RBC') then '10^6/µL'
      when test_name in ('MCV', 'Tam Kan Sayımı (Hemogram) MCV', 'RDW-SD', 'MPV', 'Tam Kan Sayımı (Hemogram) MPV') then 'fL'
      when test_name in ('MCH', 'Tam Kan Sayımı (Hemogram) MCH') then 'pg'
      when test_name in ('PDW', 'Tam Kan Sayımı (Hemogram) PDW') then
        case when coalesce(unit, '') like '%\%%' escape '\' then '%' else 'fL' end
      else unit
    end as canon_unit
  from public.lab_results
)
update public.lab_results lr
set
  test_name = m.canon_name,
  category = m.canon_cat,
  unit = m.canon_unit
from mapped m
where lr.id = m.id;

create index if not exists lab_results_user_cat_idx on public.lab_results (user_id, category);
