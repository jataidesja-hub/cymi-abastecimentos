-- ============================================================
-- Tabela principal: histórico de abastecimentos (cartão frota)
-- ============================================================
CREATE TABLE IF NOT EXISTS abastecimentos (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  data_transacao   timestamptz NOT NULL,
  tipo_combustivel text NOT NULL,
  litros           numeric(8,2),
  vl_litro         numeric(6,3) NOT NULL,
  valor_emissao    numeric(10,2),
  nome_estabelecimento text NOT NULL,
  endereco         text,
  bairro           text,
  cidade           text NOT NULL,
  uf               text NOT NULL,
  created_at       timestamptz DEFAULT now()
);

-- Índices para performance nas buscas por cidade
CREATE INDEX IF NOT EXISTS idx_abast_cidade    ON abastecimentos (cidade, uf);
CREATE INDEX IF NOT EXISTS idx_abast_posto     ON abastecimentos (nome_estabelecimento, cidade);
CREATE INDEX IF NOT EXISTS idx_abast_data      ON abastecimentos (data_transacao DESC);

-- ============================================================
-- Cache de geocoding: evita chamar Google repetidamente
-- ============================================================
CREATE TABLE IF NOT EXISTS station_locations (
  id                   uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome_estabelecimento text NOT NULL,
  cidade               text NOT NULL,
  uf                   text NOT NULL,
  latitude             double precision,
  longitude            double precision,
  geocoded_at          timestamptz DEFAULT now(),
  UNIQUE (nome_estabelecimento, cidade, uf)
);

-- ============================================================
-- View: último preço por posto + combustível
-- ============================================================
CREATE OR REPLACE VIEW latest_abastecimento_prices AS
SELECT DISTINCT ON (nome_estabelecimento, cidade, uf, tipo_combustivel)
  nome_estabelecimento,
  cidade,
  uf,
  endereco,
  bairro,
  tipo_combustivel,
  vl_litro      AS preco,
  data_transacao
FROM abastecimentos
ORDER BY nome_estabelecimento, cidade, uf, tipo_combustivel, data_transacao DESC;

-- ============================================================
-- RLS: leitura pública, inserção pública
-- ============================================================
ALTER TABLE abastecimentos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE station_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leitura abastecimentos"    ON abastecimentos    FOR SELECT USING (true);
CREATE POLICY "insercao abastecimentos"   ON abastecimentos    FOR INSERT WITH CHECK (true);
CREATE POLICY "leitura station_locations" ON station_locations FOR SELECT USING (true);
CREATE POLICY "insercao station_locations" ON station_locations FOR INSERT WITH CHECK (true);
CREATE POLICY "update station_locations"  ON station_locations FOR UPDATE USING (true);
