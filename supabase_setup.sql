-- ========================================
-- COMBUSTÍVEL BARATO - Setup do Banco
-- ========================================

-- Tabela de Postos de Combustível
CREATE TABLE IF NOT EXISTS stations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  bandeira TEXT DEFAULT 'Branco',
  endereco TEXT NOT NULL,
  cidade TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'SP',
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de Preços de Combustível
CREATE TABLE IF NOT EXISTS fuel_prices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  station_id UUID REFERENCES stations(id) ON DELETE CASCADE,
  tipo_combustivel TEXT NOT NULL CHECK (tipo_combustivel IN ('Gasolina Comum', 'Gasolina Aditivada', 'Etanol', 'Diesel S10', 'Diesel S500', 'GNV')),
  preco DECIMAL(5,3) NOT NULL CHECK (preco > 0),
  data_atualizacao TIMESTAMPTZ DEFAULT NOW(),
  reportado_por TEXT DEFAULT 'sistema'
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_stations_cidade ON stations(cidade);
CREATE INDEX IF NOT EXISTS idx_stations_location ON stations(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_fuel_prices_station ON fuel_prices(station_id);
CREATE INDEX IF NOT EXISTS idx_fuel_prices_tipo ON fuel_prices(tipo_combustivel);
CREATE INDEX IF NOT EXISTS idx_fuel_prices_data ON fuel_prices(data_atualizacao DESC);

-- View para preços mais recentes por posto e tipo
CREATE OR REPLACE VIEW latest_prices AS
SELECT DISTINCT ON (fp.station_id, fp.tipo_combustivel)
  fp.id,
  fp.station_id,
  fp.tipo_combustivel,
  fp.preco,
  fp.data_atualizacao,
  fp.reportado_por,
  s.nome,
  s.bandeira,
  s.endereco,
  s.cidade,
  s.estado,
  s.latitude,
  s.longitude
FROM fuel_prices fp
JOIN stations s ON s.id = fp.station_id
ORDER BY fp.station_id, fp.tipo_combustivel, fp.data_atualizacao DESC;

-- RLS (Row Level Security)
ALTER TABLE stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_prices ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso público para leitura
CREATE POLICY "Leitura pública de postos" ON stations FOR SELECT USING (true);
CREATE POLICY "Leitura pública de preços" ON fuel_prices FOR SELECT USING (true);
CREATE POLICY "Inserção pública de postos" ON stations FOR INSERT WITH CHECK (true);
CREATE POLICY "Inserção pública de preços" ON fuel_prices FOR INSERT WITH CHECK (true);

-- ========================================
-- DADOS DE EXEMPLO - Postos em São Paulo
-- ========================================

INSERT INTO stations (nome, bandeira, endereco, cidade, estado, latitude, longitude) VALUES
('Posto Shell Paulista', 'Shell', 'Av. Paulista, 1000', 'São Paulo', 'SP', -23.5629, -46.6544),
('Posto Ipiranga Centro', 'Ipiranga', 'R. da Consolação, 500', 'São Paulo', 'SP', -23.5505, -46.6533),
('Posto BR Vila Mariana', 'Petrobras', 'R. Domingos de Morais, 800', 'São Paulo', 'SP', -23.5882, -46.6368),
('Auto Posto Liberdade', 'Branco', 'R. da Liberdade, 300', 'São Paulo', 'SP', -23.5583, -46.6350),
('Posto Ale Moema', 'Ale', 'Av. Ibirapuera, 1500', 'São Paulo', 'SP', -23.6000, -46.6600),
('Posto Shell Pinheiros', 'Shell', 'R. dos Pinheiros, 700', 'São Paulo', 'SP', -23.5650, -46.6900),
('Posto Ipiranga Tatuapé', 'Ipiranga', 'R. Tuiuti, 1200', 'São Paulo', 'SP', -23.5350, -46.5800),
('Posto BR Santana', 'Petrobras', 'Av. Braz Leme, 300', 'São Paulo', 'SP', -23.5100, -46.6250),
('Auto Posto Lapa', 'Branco', 'R. Guaicurus, 400', 'São Paulo', 'SP', -23.5250, -46.6900),
('Posto Ale Itaquera', 'Ale', 'Av. Itaquera, 2000', 'São Paulo', 'SP', -23.5400, -46.5400),
-- Rio de Janeiro
('Posto Shell Copacabana', 'Shell', 'Av. Atlântica, 2000', 'Rio de Janeiro', 'RJ', -22.9714, -43.1822),
('Posto BR Botafogo', 'Petrobras', 'R. Voluntários da Pátria, 500', 'Rio de Janeiro', 'RJ', -22.9519, -43.1857),
('Posto Ipiranga Tijuca', 'Ipiranga', 'R. Conde de Bonfim, 800', 'Rio de Janeiro', 'RJ', -22.9280, -43.2380),
-- Belo Horizonte
('Posto Shell Savassi', 'Shell', 'Av. Getúlio Vargas, 1000', 'Belo Horizonte', 'MG', -19.9332, -43.9345),
('Posto BR Funcionários', 'Petrobras', 'Av. Afonso Pena, 3000', 'Belo Horizonte', 'MG', -19.9280, -43.9400);

-- Preços para São Paulo
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Gasolina Comum', 5.799 FROM stations s WHERE s.nome = 'Posto Shell Paulista';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Gasolina Aditivada', 6.199 FROM stations s WHERE s.nome = 'Posto Shell Paulista';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Etanol', 3.899 FROM stations s WHERE s.nome = 'Posto Shell Paulista';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Diesel S10', 6.599 FROM stations s WHERE s.nome = 'Posto Shell Paulista';

INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Gasolina Comum', 5.549 FROM stations s WHERE s.nome = 'Posto Ipiranga Centro';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Gasolina Aditivada', 5.999 FROM stations s WHERE s.nome = 'Posto Ipiranga Centro';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Etanol', 3.699 FROM stations s WHERE s.nome = 'Posto Ipiranga Centro';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Diesel S10', 6.399 FROM stations s WHERE s.nome = 'Posto Ipiranga Centro';

INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Gasolina Comum', 5.699 FROM stations s WHERE s.nome = 'Posto BR Vila Mariana';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Gasolina Aditivada', 6.099 FROM stations s WHERE s.nome = 'Posto BR Vila Mariana';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Etanol', 3.799 FROM stations s WHERE s.nome = 'Posto BR Vila Mariana';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Diesel S10', 6.499 FROM stations s WHERE s.nome = 'Posto BR Vila Mariana';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Diesel S500', 6.299 FROM stations s WHERE s.nome = 'Posto BR Vila Mariana';

INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Gasolina Comum', 5.399 FROM stations s WHERE s.nome = 'Auto Posto Liberdade';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Etanol', 3.499 FROM stations s WHERE s.nome = 'Auto Posto Liberdade';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'GNV', 4.299 FROM stations s WHERE s.nome = 'Auto Posto Liberdade';

INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Gasolina Comum', 5.649 FROM stations s WHERE s.nome = 'Posto Ale Moema';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Gasolina Aditivada', 6.049 FROM stations s WHERE s.nome = 'Posto Ale Moema';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Etanol', 3.749 FROM stations s WHERE s.nome = 'Posto Ale Moema';

INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Gasolina Comum', 5.849 FROM stations s WHERE s.nome = 'Posto Shell Pinheiros';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Gasolina Aditivada', 6.249 FROM stations s WHERE s.nome = 'Posto Shell Pinheiros';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Etanol', 3.999 FROM stations s WHERE s.nome = 'Posto Shell Pinheiros';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Diesel S10', 6.649 FROM stations s WHERE s.nome = 'Posto Shell Pinheiros';

INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Gasolina Comum', 5.499 FROM stations s WHERE s.nome = 'Posto Ipiranga Tatuapé';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Etanol', 3.599 FROM stations s WHERE s.nome = 'Posto Ipiranga Tatuapé';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Diesel S10', 6.349 FROM stations s WHERE s.nome = 'Posto Ipiranga Tatuapé';

INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Gasolina Comum', 5.599 FROM stations s WHERE s.nome = 'Posto BR Santana';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Gasolina Aditivada', 5.949 FROM stations s WHERE s.nome = 'Posto BR Santana';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Etanol', 3.649 FROM stations s WHERE s.nome = 'Posto BR Santana';

INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Gasolina Comum', 5.349 FROM stations s WHERE s.nome = 'Auto Posto Lapa';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Etanol', 3.449 FROM stations s WHERE s.nome = 'Auto Posto Lapa';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'GNV', 4.199 FROM stations s WHERE s.nome = 'Auto Posto Lapa';

INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Gasolina Comum', 5.449 FROM stations s WHERE s.nome = 'Posto Ale Itaquera';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Etanol', 3.549 FROM stations s WHERE s.nome = 'Posto Ale Itaquera';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Diesel S500', 6.149 FROM stations s WHERE s.nome = 'Posto Ale Itaquera';

-- Preços para Rio de Janeiro
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Gasolina Comum', 6.199 FROM stations s WHERE s.nome = 'Posto Shell Copacabana';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Gasolina Aditivada', 6.599 FROM stations s WHERE s.nome = 'Posto Shell Copacabana';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Etanol', 4.299 FROM stations s WHERE s.nome = 'Posto Shell Copacabana';

INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Gasolina Comum', 5.999 FROM stations s WHERE s.nome = 'Posto BR Botafogo';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Etanol', 4.099 FROM stations s WHERE s.nome = 'Posto BR Botafogo';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Diesel S10', 6.799 FROM stations s WHERE s.nome = 'Posto BR Botafogo';

INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Gasolina Comum', 5.899 FROM stations s WHERE s.nome = 'Posto Ipiranga Tijuca';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Etanol', 3.999 FROM stations s WHERE s.nome = 'Posto Ipiranga Tijuca';

-- Preços para Belo Horizonte
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Gasolina Comum', 5.899 FROM stations s WHERE s.nome = 'Posto Shell Savassi';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Gasolina Aditivada', 6.299 FROM stations s WHERE s.nome = 'Posto Shell Savassi';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Etanol', 3.999 FROM stations s WHERE s.nome = 'Posto Shell Savassi';

INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Gasolina Comum', 5.749 FROM stations s WHERE s.nome = 'Posto BR Funcionários';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Etanol', 3.849 FROM stations s WHERE s.nome = 'Posto BR Funcionários';
INSERT INTO fuel_prices (station_id, tipo_combustivel, preco) 
SELECT s.id, 'Diesel S10', 6.549 FROM stations s WHERE s.nome = 'Posto BR Funcionários';
