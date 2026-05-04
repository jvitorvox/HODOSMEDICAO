-- Migração: adiciona campo gatilho_dias em atividades_cronograma
-- Representa a antecedência em dias necessária para suprimentos
-- acionar a compra antes do início da atividade.
ALTER TABLE atividades_cronograma
  ADD COLUMN IF NOT EXISTS gatilho_dias INTEGER;
