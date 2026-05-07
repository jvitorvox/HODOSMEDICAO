-- Migração: adiciona campos gatilho_dias e campos_extras em atividades_cronograma
-- gatilho_dias: antecedência em dias para suprimentos acionar compra antes do início
-- campos_extras: campos personalizados (ExtendedAttributes) importados do MS Project XML
ALTER TABLE atividades_cronograma
  ADD COLUMN IF NOT EXISTS gatilho_dias INTEGER;

ALTER TABLE atividades_cronograma
  ADD COLUMN IF NOT EXISTS campos_extras JSONB;
